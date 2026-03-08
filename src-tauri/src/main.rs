use std::io::{Write, BufRead, BufReader};
use std::fmt::Write as FmtWrite;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use serde_json::Value;
use tauri::Emitter;

#[cfg(unix)]
use std::os::unix::net::UnixStream;

#[cfg(windows)]
use std::fs::OpenOptions;

#[cfg(unix)]
const SOCKET_PATH: &str = "/tmp/mpvsocket";

#[cfg(windows)]
const SOCKET_PATH: &str = r"\\.\pipe\mpvsocket";

// ── Global state ──────────────────────────────────────────────────────────────

struct CacheEntry { url: String, ts: std::time::Instant }

lazy_static::lazy_static! {
    static ref PREFETCH_CACHE: Arc<Mutex<HashMap<String, CacheEntry>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Sleep timer with generation counter to prevent double-fire race (vuln #8)
    static ref SLEEP_TIMER: Arc<Mutex<Option<(std::time::Instant, u64)>>> =
        Arc::new(Mutex::new(None));
    static ref SLEEP_TIMER_GEN: Arc<Mutex<u64>> = Arc::new(Mutex::new(0));

    // Stream cache directory — set by the frontend, used by mpv for disk caching
    static ref STREAM_CACHE_DIR: Arc<Mutex<String>> =
        Arc::new(Mutex::new(default_cache_dir()));
}

fn default_cache_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .map(|h| format!("{}\\Documents\\VanguardCache", h))
            .unwrap_or_else(|_| "C:\\Users\\Public\\Documents\\VanguardCache".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .map(|h| format!("{}/Documents/VanguardCache", h))
            .unwrap_or_else(|_| "/tmp/VanguardCache".to_string())
    }
}

// ── Path helper ───────────────────────────────────────────────────────────────

fn expand_tilde(path: &str) -> String {
    if path == "~" || path.starts_with("~/") || path.starts_with("~\\") {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        return path.replacen('~', &home, 1);
    }
    path.to_string()
}

// URL allowlist — only allow safe schemes, prevent argument injection (CRITICAL #1)
fn sanitize_stream_url(url: &str) -> Result<String, String> {
    let u = url.trim();
    if u.starts_with("https://") || u.starts_with("http://") {
        Ok(u.to_string())
    } else {
        Err(format!("Rejected URL with unsafe scheme: {}", &u[..u.len().min(80)]))
    }
}

// Sanitize local file path — prevent traversal and flag injection (CRITICAL #3)
fn sanitize_file_path(path: &str) -> Result<std::path::PathBuf, String> {
    let expanded = expand_tilde(path.trim_start_matches("local://").trim());
    let p = std::path::Path::new(&expanded);
    if !p.is_absolute() {
        return Err(format!("Path must be absolute: {}", &expanded[..expanded.len().min(200)]));
    }
    match p.canonicalize() {
        Ok(canon) => Ok(canon),
        Err(_) => {
            if expanded.contains("..") {
                return Err("Path traversal not allowed".to_string());
            }
            Ok(p.to_path_buf())
        }
    }
}

// Proper JSON string escaping — prevents IPC injection (CRITICAL #2)
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '"'  => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => { let _ = std::fmt::Write::write_fmt(&mut out, format_args!("\\u{:04x}", c as u32)); }
            c => out.push(c),
        }
    }
    out
}

// Safe f64 for JSON — NaN/Infinity are invalid JSON (vuln #19)
fn safe_f64(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

// ── Dependency checker ────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct DepsStatus {
    mpv: bool,
    yt_dlp: bool,
    ffprobe: bool,
    spotdl: bool,
}

#[tauri::command]
async fn check_dependencies() -> Result<DepsStatus, String> {
    tokio::task::spawn_blocking(|| {
        let mpv = Command::new("mpv").arg("--version").output().is_ok();
        let yt_dlp = Command::new("yt-dlp").arg("--version").output().is_ok();
        let ffprobe = Command::new("ffprobe").arg("-version").output().is_ok();
        let spotdl = Command::new("spotdl").arg("--version").output().is_ok();
        Ok(DepsStatus { mpv, yt_dlp, ffprobe, spotdl })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── yt-dlp version / update ───────────────────────────────────────────────────

#[tauri::command]
async fn get_yt_dlp_version() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let out = Command::new("yt-dlp")
            .arg("--version")
            .output()
            .map_err(|_| "yt-dlp not found".to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_yt_dlp() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let out = Command::new("yt-dlp")
            .arg("-U")
            .output()
            .map_err(|_| "yt-dlp not found".to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Ok(if stdout.trim().is_empty() { stderr } else { stdout })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── spotdl helpers ────────────────────────────────────────────────────────────

fn try_install_spotdl_cmd(program: &str, args: &[&str]) -> Result<String, String> {
    match Command::new(program).args(args).output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if out.status.success() {
                Ok(if stdout.trim().is_empty() { stderr } else { stdout })
            } else {
                Err(stderr.trim().to_string())
            }
        }
        Err(e) => Err(format!("{} not found: {}", program, e)),
    }
}

fn pip_install_spotdl() -> Result<String, String> {
    // Modern Debian/Ubuntu (PEP 668) blocks system-wide pip installs.
    // Try methods in order of cleanliness:
    //   1. pipx  — creates isolated venv, recommended by Debian
    //   2. pip3/pip --break-system-packages  — explicit override (safe for app tools)
    //   3. pip3/pip --user  — user-level install
    //   4. python3 -m pip variants with same flags

    // Method 1: pipx (Linux/macOS preferred on PEP 668 systems)
    #[cfg(not(target_os = "windows"))]
    {
        // Make sure pipx is installed first (try apt, then pip)
        let has_pipx = Command::new("pipx").arg("--version").output()
            .map(|o| o.status.success()).unwrap_or(false);
        if !has_pipx {
            // Try installing pipx via apt (no sudo -n so it may still fail, but worth trying)
            let _ = Command::new("sudo").args(["-n", "apt-get", "install", "-y", "pipx"])
                .env("DEBIAN_FRONTEND", "noninteractive").output();
            // Or via pip with break-system-packages
            let _ = Command::new("pip3")
                .args(["install", "--break-system-packages", "--upgrade", "pipx"]).output();
        }
        if Command::new("pipx").arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
            match try_install_spotdl_cmd("pipx", &["install", "spotdl", "--force"]) {
                Ok(s) => {
                    // Ensure pipx bin dir is on PATH for future invocations
                    let _ = Command::new("pipx").arg("ensurepath").output();
                    return Ok(format!("Installed via pipx.
{}", s));
                }
                Err(_) => {}
            }
        }
    }

    // Method 2: pip3/pip --break-system-packages (Debian/Ubuntu PEP 668 override)
    #[cfg(not(target_os = "windows"))]
    let pip_bins = ["pip3", "pip"];
    #[cfg(target_os = "windows")]
    let pip_bins = ["pip", "pip3"];

    for pip in &pip_bins {
        match try_install_spotdl_cmd(pip, &["install", "--upgrade", "--break-system-packages", "spotdl"]) {
            Ok(s) => return Ok(s),
            Err(_) => {}
        }
    }

    // Method 3: --user install (no root, no system override needed)
    for pip in &pip_bins {
        match try_install_spotdl_cmd(pip, &["install", "--upgrade", "--user", "spotdl"]) {
            Ok(s) => return Ok(s),
            Err(_) => {}
        }
    }

    // Method 4: python3 -m pip variants
    #[cfg(not(target_os = "windows"))]
    let py_bins = ["python3", "python"];
    #[cfg(target_os = "windows")]
    let py_bins = ["python", "python3"];

    for py in &py_bins {
        for flag in &["--break-system-packages", "--user"] {
            match try_install_spotdl_cmd(py, &["-m", "pip", "install", "--upgrade", flag, "spotdl"]) {
                Ok(s) => return Ok(s),
                Err(_) => {}
            }
        }
    }

    // Method 5: Windows pip direct (no extra flags)
    #[cfg(target_os = "windows")]
    {
        match try_install_spotdl_cmd("pip", &["install", "--upgrade", "spotdl"]) {
            Ok(s) => return Ok(s),
            Err(_) => {}
        }
        match try_install_spotdl_cmd("python", &["-m", "pip", "install", "--upgrade", "spotdl"]) {
            Ok(s) => return Ok(s),
            Err(_) => {}
        }
    }

    Err(
        "Could not install spotdl automatically.

Try manually:
          pipx install spotdl
          pip3 install --break-system-packages spotdl
          pip3 install --user spotdl

        If pipx is not installed: sudo apt install pipx".to_string()
    )
}

#[tauri::command]
async fn get_spotdl_version() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let out = Command::new("spotdl")
            .arg("--version")
            .output()
            .map_err(|_| "spotdl not installed".to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_spotdl() -> Result<String, String> {
    tokio::task::spawn_blocking(pip_install_spotdl)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_spotdl() -> Result<String, String> {
    tokio::task::spawn_blocking(pip_install_spotdl)
        .await
        .map_err(|e| e.to_string())?
}

// ── YouTube search ────────────────────────────────────────────────────────────

#[tauri::command]
async fn search_youtube(query: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let output = Command::new("yt-dlp")
            .args([
                &format!("ytsearch10:{}", query),
                "--flat-playlist",
                "--print",
                "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
                "--no-warnings",
            ])
            .output()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if stdout.trim().is_empty() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(if stderr.trim().is_empty() {
                "No results found".to_string()
            } else {
                stderr
            });
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Spotify playlist extractor ───────────────────────────────────────────────
// Three methods tried in order — guarantees complete playlists of any size:
//
//  Method A: Spotify Web API via anonymous token from open.spotify.com/get_access_token
//            Uses full pagination (offset/limit 50), gets every track.
//            The token endpoint returns HTTP 200 even without cookies when the
//            right headers are sent — key is sp_dc is NOT required for public playlists.
//
//  Method B: Embed page scrape for first 100 + partner API for remaining pages
//
//  Method C: yt-dlp --flat-playlist (works if yt-dlp has working Spotify extractor)

fn sp_curl(url: &str, headers: &[(&str, &str)]) -> Result<String, String> {
    let mut args: Vec<String> = vec![
        "-s".to_string(), "-L".to_string(),
        "--max-time".to_string(), "20".to_string(),
        "--compressed".to_string(),
        "-A".to_string(),
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36".to_string(),
        "-H".to_string(), "Accept: application/json, text/html, */*".to_string(),
        "-H".to_string(), "Accept-Language: en-US,en;q=0.9".to_string(),
        "-H".to_string(), "Origin: https://open.spotify.com".to_string(),
        "-H".to_string(), "Referer: https://open.spotify.com/".to_string(),
    ];
    for (k, v) in headers {
        args.push("-H".to_string());
        args.push(format!("{}: {}", k, v));
    }
    args.push(url.to_string());
    let out = Command::new("curl").args(&args).output()
        .map_err(|e| format!("curl: {}", e))?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// ── Method A: spotdl save --save-file (most reliable, no auth needed) ───────
// spotdl uses its own embedded Spotify client credentials — works on any public
// playlist of any size. Outputs a .spotdl JSON file we parse for track metadata.
fn method_spotdl(playlist_id: &str) -> Result<(String, Vec<(String, String)>), String> {
    // Check spotdl is installed
    if Command::new("spotdl").arg("--version").output().is_err() {
        return Err("spotdl not installed".to_string());
    }

    let url = format!("https://open.spotify.com/playlist/{}", playlist_id);

    // Use user-private temp dir — /tmp is world-readable (vuln #16 fix)
    #[cfg(target_os = "windows")]
    let tmp_path = format!("{}\\vg_spotdl_{}.spotdl",
        std::env::var("TEMP").unwrap_or_else(|_| std::env::var("TMP").unwrap_or_else(|_| "C:\\Temp".to_string())),
        std::process::id()
    );
    #[cfg(not(target_os = "windows"))]
    let tmp_path = {
        let uid = unsafe { libc_getuid() };
        let run = format!("/run/user/{}", uid);
        if std::path::Path::new(&run).exists() {
            format!("{}/vg_spotdl_{}.spotdl", run, std::process::id())
        } else {
            format!("/tmp/vg_spotdl_{}.spotdl", std::process::id())
        }
    };

    // spotdl save <url> --save-file <path>
    // This only fetches metadata, does NOT download any audio
    let out = Command::new("spotdl")
        .args(["save", &url, "--save-file", &tmp_path])
        .output()
        .map_err(|e| format!("spotdl failed to run: {}", e))?;

    if !std::path::Path::new(&tmp_path).exists() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(format!("spotdl produced no output file. stdout: {} stderr: {}", &stdout[..stdout.len().min(300)], &stderr[..stderr.len().min(300)]));
    }

    // Cap at 50MB to prevent DoS from crafted output (vuln #7 fix)
    if let Ok(m) = std::fs::metadata(&tmp_path) {
        if m.len() > 50 * 1024 * 1024 {
            let _ = std::fs::remove_file(&tmp_path);
            return Err("spotdl output too large".to_string());
        }
    }
    let file_content = std::fs::read_to_string(&tmp_path)
        .map_err(|e| format!("Could not read spotdl output: {}", e))?;
    let _ = std::fs::remove_file(&tmp_path);

    let songs: Value = serde_json::from_str(&file_content)
        .map_err(|e| format!("spotdl JSON parse failed: {}", e))?;

    let songs_arr = songs.as_array()
        .ok_or("spotdl output is not a JSON array")?;

    if songs_arr.is_empty() {
        return Err("spotdl returned empty playlist".to_string());
    }

    // Extract playlist name from first song's album_artist or artist
    let playlist_name = songs_arr.first()
        .and_then(|s| s["list_name"].as_str()
            .or_else(|| s["album_name"].as_str())
            .or_else(|| s["publisher"].as_str()))
        .unwrap_or("Spotify Import")
        .to_string();

    let mut tracks: Vec<(String, String)> = Vec::new();
    for song in songs_arr {
        let name = song["name"].as_str().unwrap_or("").trim().to_string();
        if name.is_empty() { continue; }

        // Artist: prefer "artist" field, fall back to first of "artists" array
        let artist = song["artist"].as_str()
            .or_else(|| song["artists"].as_array()
                .and_then(|a| a.first())
                .and_then(|a| a.as_str()))
            .unwrap_or("").trim().to_string();

        tracks.push((name, artist));
    }

    if tracks.is_empty() {
        return Err("spotdl returned songs with no names".to_string());
    }

    Ok((playlist_name, tracks))
}


// ── Method B: Embed page scrape + internal API pagination ───────────────────
fn extract_next_data(html: &str) -> Option<Value> {
    let marker = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let start = html.find(marker)? + marker.len();
    let end = html[start..].find("</script>")?;
    if end > 4 * 1024 * 1024 { return None; } // cap at 4MB (vuln #17 fix)
    serde_json::from_str(&html[start..start+end]).ok()
}

fn method_embed(playlist_id: &str) -> Result<(String, Vec<(String, String)>), String> {
    let html = sp_curl(
        &format!("https://open.spotify.com/embed/playlist/{}?utm_source=oembed", playlist_id),
        &[],
    )?;

    let data = extract_next_data(&html)
        .ok_or("Could not parse embed page")?;

    let entity = &data["props"]["pageProps"]["state"]["data"]["entity"];
    let playlist_name = entity["name"].as_str().unwrap_or("").to_string();

    // Token for pagination
    let token = data["props"]["pageProps"]["accessToken"]
        .as_str().map(|s| s.to_string());

    let mut all_tracks: Vec<(String, String)> = Vec::new();

    if let Some(list) = entity["trackList"].as_array() {
        for item in list {
            let title = item["title"].as_str().or_else(|| item["name"].as_str()).unwrap_or("").trim().to_string();
            if title.is_empty() { continue; }
            let artist = item["subtitle"].as_str().unwrap_or("").trim().to_string();
            all_tracks.push((title, artist));
        }
    }

    // Paginate with bearer token against the partner API
    if let Some(tok) = token {
        let auth = format!("Bearer {}", tok);
        let mut offset = all_tracks.len();

        // Try known working persisted query hashes (Spotify rotates these)
        let hashes = [
            "149ed840700e8f9b19e48b59e5d24cc64d98f4e0b4f09d0c6ccc9f91c0b96e6c",
            "3ce876571c53bbc72f94a9ff7b52e48f79edd2f8c6cfab73b75f0f70c4c1e29d",
            "91d41f2a5a3f45f41c6c603f18ba7e02f52bfdb619c13b7b8b0a49a8b68e0ebb",
        ];

        'outer: for hash in &hashes {
            let mut page_off = offset;
            loop {
                let vars = urlenc(&format!(
                    r#"{{"uri":"spotify:playlist:{}","offset":{},"limit":100}}"#,
                    playlist_id, page_off
                ));
                let exts = urlenc(&format!(
                    r#"{{"persistedQuery":{{"version":1,"sha256Hash":"{}"}}}}"#, hash
                ));
                let api_url = format!(
                    "https://api-partner.spotify.com/pathfinder/v1/query?operationName=fetchPlaylist&variables={}&extensions={}",
                    vars, exts
                );
                let resp = sp_curl(&api_url, &[
                    ("Authorization", auth.as_str()),
                    ("spotify-app-version", "1.2.46.25.g3c8c9b63"),
                    ("app-platform", "WebPlayer"),
                ])?;
                let json: Value = match serde_json::from_str(&resp) {
                    Ok(v) => v, Err(_) => break,
                };
                if !json["errors"].is_null() || json["data"].is_null() { break; }

                let items = match json["data"]["playlistV2"]["content"]["items"].as_array() {
                    Some(i) if !i.is_empty() => i.clone(),
                    _ => break 'outer,
                };

                let before = all_tracks.len();
                for item in &items {
                    let d = &item["itemV2"]["data"];
                    let title = d["name"].as_str().unwrap_or("").trim().to_string();
                    if title.is_empty() { continue; }
                    let artist = d["artists"]["items"].as_array()
                        .and_then(|a| a.first())
                        .and_then(|a| a["profile"]["name"].as_str())
                        .unwrap_or("").trim().to_string();
                    all_tracks.push((title, artist));
                }

                if all_tracks.len() == before { break 'outer; }
                page_off = all_tracks.len();

                let total = json["data"]["playlistV2"]["content"]["totalCount"].as_i64().unwrap_or(0);
                if total > 0 && page_off as i64 >= total { break 'outer; }
                if page_off >= 10000 { break 'outer; } // up to 10k tracks
            }
        }
    }

    if all_tracks.is_empty() {
        return Err("method_embed: no tracks".to_string());
    }
    Ok((playlist_name, all_tracks))
}

// ── Method C: yt-dlp --flat-playlist ────────────────────────────────────────
fn method_ytdlp(playlist_id: &str) -> Result<(String, Vec<(String, String)>), String> {
    let url = format!("https://open.spotify.com/playlist/{}", playlist_id);
    let out = Command::new("yt-dlp")
        .args(["--flat-playlist", "--no-warnings", "--no-check-certificates",
               "--ignore-errors", "--print", "%()j", &url])
        .output()
        .map_err(|e| format!("yt-dlp: {}", e))?;

    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    if raw.trim().is_empty() {
        return Err("yt-dlp: empty output".to_string());
    }

    let mut playlist_name = String::new();
    let mut tracks: Vec<(String, String)> = Vec::new();

    for line in raw.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { continue };
        if playlist_name.is_empty() {
            if let Some(n) = v["playlist_title"].as_str().or_else(|| v["playlist"].as_str()) {
                if !n.is_empty() && n != "NA" { playlist_name = n.to_string(); }
            }
        }
        let title = v["track"].as_str().or_else(|| v["title"].as_str()).unwrap_or("").trim().to_string();
        if title.is_empty() || title == "NA" { continue; }
        let artist = v["artist"].as_str().or_else(|| v["uploader"].as_str()).unwrap_or("").trim().to_string();
        tracks.push((title, if artist == "NA" { String::new() } else { artist }));
    }

    if tracks.is_empty() {
        // Fallback print format
        let out2 = Command::new("yt-dlp")
            .args(["--flat-playlist", "--no-warnings", "--no-check-certificates",
                   "--ignore-errors", "--print", "%(track)s====%(artist)s", &url])
            .output().map_err(|e| format!("yt-dlp: {}", e))?;
        for line in String::from_utf8_lossy(&out2.stdout).lines() {
            if let Some((t, a)) = line.split_once("====") {
                let t = t.trim(); let a = a.trim();
                if !t.is_empty() && t != "NA" {
                    tracks.push((t.to_string(), if a == "NA" { String::new() } else { a.to_string() }));
                }
            }
        }
    }

    if tracks.is_empty() { return Err("yt-dlp: no tracks".to_string()); }
    Ok((playlist_name, tracks))
}

fn urlenc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => { out.push('%'); out.push_str(&format!("{:02X}", b)); }
        }
    }
    out
}

#[tauri::command]
async fn search_spotify_playlist(url: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let playlist_id = url
            .split("/playlist/").nth(1).unwrap_or("")
            .split(|c: char| c == '?' || c == '#').next().unwrap_or("")
            .trim().to_string();

        if playlist_id.is_empty() {
            return Err("Could not parse playlist ID from URL".to_string());
        }

        // Try all methods — first success wins
        // A: spotdl (best — uses its own Spotify credentials, any playlist size)
        // B: embed page scrape + partner API (works without spotdl, capped heuristically)
        // C: yt-dlp flat-playlist (works if yt-dlp has a working Spotify extractor)
        let result = method_spotdl(&playlist_id)
            .or_else(|e1| method_embed(&playlist_id).map_err(|e2| format!("spotdl: {} | embed: {}", e1, e2)))
            .or_else(|e12| method_ytdlp(&playlist_id).map_err(|e3| format!("{} | yt-dlp: {}", e12, e3)))?;

        let (playlist_name, all_tracks) = result;
        let mut output = format!("PLAYLIST:{}\n", playlist_name);
        for (title, artist) in all_tracks {
            output.push_str(&format!("{}===={}\n", title, artist));
        }
        Ok(output)
    })
    .await
    .map_err(|e| e.to_string())?
}
// ── Prefetch ──────────────────────────────────────────────────────────────────
// Fires-and-forgets in a background task. Stores the direct stream URL so
// play_audio can skip the yt-dlp resolve step entirely.

#[tauri::command]
async fn prefetch_track(url: String) -> Result<(), String> {
    // Local files don't need prefetching
    if url.starts_with("local://") {
        return Ok(());
    }
    if PREFETCH_CACHE.lock().unwrap().contains_key(&url) {
        return Ok(());
    }
    let cache = Arc::clone(&PREFETCH_CACHE);
    tokio::spawn(async move {
        let url_clone = url.clone();
        let result = tokio::task::spawn_blocking(move || {
            Command::new("yt-dlp")
                .args([
                    "--get-url",
                    "--format", "bestaudio/best",
                    "--no-check-certificates",
                    "--no-warnings",
                    &url_clone,
                ])
                .output()
        })
        .await;

        if let Ok(Ok(out)) = result {
            let stream_url = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if stream_url.starts_with("https://") || stream_url.starts_with("http://") {
                let mut c = cache.lock().unwrap();
                let now = std::time::Instant::now();
                let ttl = std::time::Duration::from_secs(3600);
                // Evict expired + cap at 50 entries (vuln #13 fix)
                c.retain(|_, v| now.duration_since(v.ts) < ttl);
                if c.len() >= 50 { c.clear(); }
                c.insert(url, CacheEntry { url: stream_url, ts: now });
            }
        }
    });
    Ok(())
}

// ── Playback ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn set_cache_dir(path: String) -> Result<(), String> {
    let expanded = if path.starts_with('~') {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
        path.replacen('~', &home, 1)
    } else { path };
    // Create dir if needed
    let _ = std::fs::create_dir_all(&expanded);
    *STREAM_CACHE_DIR.lock().unwrap() = expanded;
    Ok(())
}

#[tauri::command]
fn get_cache_dir() -> String {
    STREAM_CACHE_DIR.lock().unwrap().clone()
}

#[tauri::command]
fn get_cache_size() -> u64 {
    let dir = STREAM_CACHE_DIR.lock().unwrap().clone();
    fn dir_size(p: &std::path::Path) -> u64 {
        let Ok(rd) = std::fs::read_dir(p) else { return 0; };
        rd.flatten().map(|e| {
            let m = e.metadata().ok();
            if m.as_ref().map(|m| m.is_dir()).unwrap_or(false) { dir_size(&e.path()) }
            else { m.map(|m| m.len()).unwrap_or(0) }
        }).sum()
    }
    dir_size(std::path::Path::new(&dir))
}

#[tauri::command]
fn clear_cache() -> Result<u64, String> {
    let dir = STREAM_CACHE_DIR.lock().unwrap().clone();
    let p = std::path::Path::new(&dir);
    if !p.exists() { return Ok(0); }
    fn dir_size(p: &std::path::Path) -> u64 {
        let Ok(rd) = std::fs::read_dir(p) else { return 0; };
        rd.flatten().map(|e| {
            let m = e.metadata().ok();
            if m.as_ref().map(|m| m.is_dir()).unwrap_or(false) { dir_size(&e.path()) }
            else { m.map(|m| m.len()).unwrap_or(0) }
        }).sum()
    }
    let freed = dir_size(p);
    std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    Ok(freed)
}

#[tauri::command]
async fn play_audio(url: String) -> Result<(), String> {
    if url.starts_with("local://") {
        return play_local_file(url.trim_start_matches("local://").to_string()).await;
    }
    // Validate URL scheme — prevents argument injection (CRITICAL #1)
    let safe_url = sanitize_stream_url(&url)?;

    tokio::task::spawn_blocking(move || {
        // Drain prefetch cache with TTL validation
        let actual_url = {
            let mut cache = PREFETCH_CACHE.lock().unwrap();
            if let Some(entry) = cache.remove(&safe_url) {
                let ttl = std::time::Duration::from_secs(3600);
                if std::time::Instant::now().duration_since(entry.ts) < ttl
                    && (entry.url.starts_with("https://") || entry.url.starts_with("http://")) {
                    entry.url
                } else { safe_url.clone() }
            } else { safe_url.clone() }
        };

        kill_mpv();
        cleanup_socket();

        // --cache-dir REMOVED: not a valid option on all mpv builds.
        // Caused "Error parsing option cache-dir" on Linux. mpv manages its own temp cache.
        Command::new("mpv")
            .args([
                "--no-video",
                "--cache=yes",
                "--cache-secs=30",
                "--demuxer-max-bytes=32MiB",
                "--demuxer-max-back-bytes=8MiB",
                "--demuxer-readahead-secs=10",
                "--cache-pause=no",
                "--network-timeout=20",
                "--audio-buffer=0.5",
                "--audio-pitch-correction=yes",
                "--af=loudnorm=I=-16:TP=-1.5:LRA=11",
                "--script-opts=ytdl_hook-ytdl_path=yt-dlp",
                "--ytdl-format=bestaudio[ext=webm]/bestaudio/best",
                "--ytdl-raw-options=ignore-config=,no-check-certificates=,retries=5,fragment-retries=5,concurrent-fragments=4",
                &format!("--input-ipc-server={}", SOCKET_PATH),
                "--force-window=no",
                "--keep-open=yes",
                "--idle=yes",
                "--", // Everything after is a URL/file, never a flag (CRITICAL #1)
                &actual_url,
            ])
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        wait_for_socket(5000);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn play_local_file(path: String) -> Result<(), String> {
    // Validate path — prevents traversal and flag injection (CRITICAL #3)
    let safe_path = sanitize_file_path(&path)?.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        kill_mpv();
        cleanup_socket();

        Command::new("mpv")
            .args([
                "--no-video",
                "--cache=yes",
                "--demuxer-max-bytes=32MiB",
                "--audio-buffer=0.5",
                "--audio-pitch-correction=yes",
                "--af=loudnorm=I=-16:TP=-1.5:LRA=11",
                &format!("--input-ipc-server={}", SOCKET_PATH),
                "--force-window=no",
                "--keep-open=yes",
                "--idle=yes",
                "--",  // path can never be a flag (CRITICAL #3)
                &safe_path,
            ])
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        wait_for_socket(3000);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── IPC — playback control ─────────────────────────────────────────────────────

#[tauri::command]
async fn pause_audio() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        send_ipc_command_with_retry(r#"{"command": ["cycle", "pause"]}"#, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn seek_audio(time: f64) -> Result<(), String> {
    if !time.is_finite() { return Err("Invalid seek time".to_string()); }
    let t = safe_f64(time);
    tokio::task::spawn_blocking(move || {
        let cmd = format!(r#"{{"command": ["seek", {}, "absolute"]}}"#, t);
        send_ipc_command_with_retry(&cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn seek_relative(seconds: f64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let cmd = format!(r#"{{"command": ["seek", {}, "relative"]}}"#, seconds);
        send_ipc_command_with_retry(&cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_volume(volume: f64) -> Result<(), String> {
    let vol = safe_f64(volume).clamp(0.0, 150.0);
    tokio::task::spawn_blocking(move || {
        let cmd = format!(r#"{{"command": ["set_property", "volume", {}]}}"#, vol);
        send_ipc_command_with_retry(&cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_progress() -> Result<f64, String> {
    tokio::task::spawn_blocking(|| {
        let response = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "time-pos"]}"#, 2
        )?;
        parse_f64_from_response(&response)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_duration() -> Result<f64, String> {
    tokio::task::spawn_blocking(|| {
        let response = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "duration"]}"#, 2
        )?;
        parse_f64_from_response(&response)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn is_paused() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let response = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "pause"]}"#, 2
        )?;
        let json: Value = serde_json::from_str(&response).map_err(|e| e.to_string())?;
        Ok(json["data"].as_bool().unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Playback state snapshot ───────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct PlaybackState {
    playing: bool,
    paused: bool,
    position: f64,
    duration: f64,
    eof_reached: bool,
}

#[tauri::command]
async fn get_playback_state() -> Result<PlaybackState, String> {
    // Reduced to 3 IPC calls (was 4). Shorter timeouts. safe_f64 guards NaN (vuln #12, #19)
    tokio::task::spawn_blocking(|| {
        let pause_resp = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "pause"]}"#, 1
        ).map_err(|_| "mpv not running".to_string())?;

        let paused = {
            let j: Value = serde_json::from_str(&pause_resp).unwrap_or(Value::Null);
            j["data"].as_bool().unwrap_or(false)
        };

        let position = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "time-pos"]}"#, 0
        ).ok().and_then(|r| parse_f64_from_response(&r).ok()).map(safe_f64).unwrap_or(0.0);

        let duration = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "duration"]}"#, 0
        ).ok().and_then(|r| parse_f64_from_response(&r).ok()).map(safe_f64).unwrap_or(0.0);

        // Use near-end heuristic instead of eof-reached IPC call (saves 1 round-trip)
        // With --keep-open, mpv pauses at EOF — detect by: near end AND paused
        let near_end = duration > 0.0 && position > 5.0 && (duration - position) < 1.5 && paused;

        Ok(PlaybackState { playing: !paused, paused, position, duration, eof_reached: near_end })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Seek to start (used for repeat-one restart) ───────────────────────────────
// With --keep-open the track is paused at EOF. We seek to 0 and unpause.

#[tauri::command]
async fn seek_to_start() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        // Seek to beginning
        send_ipc_command_with_retry(r#"{"command": ["seek", 0, "absolute"]}"#, 3).map(|_| ())?;
        // Small pause to let mpv process the seek
        std::thread::sleep(std::time::Duration::from_millis(80));
        // Ensure it's unpaused
        send_ipc_command_with_retry(r#"{"command": ["set_property", "pause", false]}"#, 3).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Playback speed ────────────────────────────────────────────────────────────

#[tauri::command]
async fn set_playback_speed(speed: f64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let cmd = format!(r#"{{"command": ["set_property", "speed", {}]}}"#, speed);
        send_ipc_command_with_retry(&cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

// Pitch shift in semitones — uses audio-pitch-correction + af scaletempo2
// semitones: -12 to +12. 0 = no shift.
#[tauri::command]
async fn set_pitch(semitones: f64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let semitones = semitones.clamp(-12.0, 12.0);
        if (semitones).abs() < 0.01 {
            // Reset — just disable pitch correction override
            let cmd = r#"{"command": ["set_property", "audio-pitch-correction", false]}"#;
            let _ = send_ipc_command_with_retry(cmd, 2);
            return Ok(());
        }
        // Convert semitones to frequency ratio: ratio = 2^(semitones/12)
        let ratio = 2f64.powf(semitones / 12.0);
        // Use scaletempo2 with pitch-scale to shift pitch without changing speed
        // af=scaletempo2:scale=<ratio> works in mpv 0.35+
        let af_cmd = format!(
            r#"{{"command": ["set_property", "af", "scaletempo2:scale={}:speed=pitch,loudnorm=I=-16:TP=-1.5:LRA=11"]}}"#,
            ratio
        );
        send_ipc_command_with_retry(&af_cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_playback_speed() -> Result<f64, String> {
    tokio::task::spawn_blocking(|| {
        let response = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "speed"]}"#, 2
        )?;
        parse_f64_from_response(&response)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Audio info ────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AudioInfo {
    codec: String,
    bitrate: f64,
    samplerate: f64,
    channels: i64,
}

#[tauri::command]
async fn get_audio_info() -> Result<AudioInfo, String> {
    tokio::task::spawn_blocking(|| {
        let codec = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "audio-codec-name"]}"#, 1
        )
        .ok()
        .and_then(|r| {
            let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null);
            j["data"].as_str().map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

        let bitrate = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "audio-bitrate"]}"#, 1
        )
        .ok()
        .and_then(|r| parse_f64_from_response(&r).ok())
        .unwrap_or(0.0);

        let samplerate = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "audio-samplerate"]}"#, 1
        )
        .ok()
        .and_then(|r| parse_f64_from_response(&r).ok())
        .unwrap_or(0.0);

        let channels = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "audio-channels"]}"#, 1
        )
        .ok()
        .and_then(|r| {
            let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null);
            j["data"].as_i64()
        })
        .unwrap_or(0);

        Ok(AudioInfo { codec, bitrate, samplerate, channels })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Equalizer ─────────────────────────────────────────────────────────────────
// Modern mpv (0.35+) removed af-add/af-remove commands.
// The correct approach is set_property on "af" with a full filter chain string.
// We always include loudnorm so it is never lost when EQ is applied.
// If all bands are 0 we set just loudnorm (no-op equalizer avoided).

#[tauri::command]
async fn set_equalizer(bass: f64, mid: f64, treble: f64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Clamp to valid range -12..12 dB
        let b = bass.clamp(-12.0, 12.0);
        let m = mid.clamp(-12.0, 12.0);
        let t = treble.clamp(-12.0, 12.0);

        let af_value = if b == 0.0 && m == 0.0 && t == 0.0 {
            // No EQ — just keep loudnorm
            "loudnorm=I=-16:TP=-1.5:LRA=11".to_string()
        } else {
            // loudnorm first, then equalizer
            // equalizer= takes 10 bands (dB), colon-separated:
            // 31Hz 63Hz 125Hz 250Hz 500Hz 1kHz 2kHz 4kHz 8kHz 16kHz
            format!(
                "loudnorm=I=-16:TP=-1.5:LRA=11,equalizer={b}:{b}:{b}:{b}:{m}:{m}:{m}:{m}:{t}:{t}",
                b = b, m = m, t = t
            )
        };

        // Use set_property "af" — the correct API in mpv 0.35+
        let cmd = format!(
            r#"{{"command": ["set_property", "af", "{}"]}}"#,
            af_value
        );
        send_ipc_command_with_retry(&cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Download ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn download_song(url: String, quality: String, path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let resolved_path = expand_tilde(&path);

        // Format selector — picks appropriate source bitrate tier
        let format = match quality.as_str() {
            "Low"    => "worstaudio/worst",
            "Medium" => "bestaudio[abr<=160]/bestaudio/best",
            _        => "bestaudio/best",
        };

        // LAME VBR quality: 0 = best (~245kbps), 4 = medium (~165kbps), 9 = worst (~65kbps)
        let audio_quality = match quality.as_str() {
            "Low"    => "9",
            "Medium" => "4",
            _        => "0",
        };

        let sep = std::path::MAIN_SEPARATOR;
        let output_template = if resolved_path.ends_with('/') || resolved_path.ends_with('\\') {
            format!("{}%(title)s.%(ext)s", resolved_path)
        } else {
            format!("{}{}%(title)s.%(ext)s", resolved_path, sep)
        };

        let output = Command::new("yt-dlp")
            .args([
                "-f", format,
                "--extract-audio",
                "--audio-format", "mp3",
                "--audio-quality", audio_quality,
                "--embed-thumbnail",
                "--add-metadata",
                "--no-check-certificates",
                "--no-warnings",
                "-o", &output_template,
                &url,
            ])
            .output()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        if output.status.success() {
            Ok("Downloaded successfully".to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Batch download with progress events ──────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct BatchProgress {
    index: usize,
    total: usize,
    title: String,
    success: bool,
    error: Option<String>,
}

#[tauri::command]
async fn batch_download(
    app_handle: tauri::AppHandle,
    urls: Vec<String>,
    quality: String,
    path: String,
) -> Result<(), String> {
    let total = urls.len();
    let resolved_path = expand_tilde(&path);

    for (i, url) in urls.iter().enumerate() {
        let url_clone = url.clone();
        let quality_clone = quality.clone();
        let path_clone = resolved_path.clone();

        let result: Result<String, String> = tokio::task::spawn_blocking(move || {
            let format = match quality_clone.as_str() {
                "Low"    => "worstaudio/worst",
                "Medium" => "bestaudio[abr<=160]/bestaudio/best",
                _        => "bestaudio/best",
            };
            let audio_quality = match quality_clone.as_str() {
                "Low"    => "9",
                "Medium" => "4",
                _        => "0",
            };
            let sep = std::path::MAIN_SEPARATOR;
            let tpl = format!("{}{}%(title)s.%(ext)s", path_clone, sep);

            let out = Command::new("yt-dlp")
                .args([
                    "-f", format,
                    "--extract-audio",
                    "--audio-format", "mp3",
                    "--audio-quality", audio_quality,
                    "--embed-thumbnail",
                    "--add-metadata",
                    "--no-check-certificates",
                    "--no-warnings",
                    "-o", &tpl,
                    &url_clone,
                ])
                .output()
                .map_err(|e| format!("yt-dlp not found: {}", e))?;

            if out.status.success() {
                // Extract title from output for progress reporting
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                Ok(stdout)
            } else {
                Err(String::from_utf8_lossy(&out.stderr).to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())?;

        let (success, error) = match &result {
            Ok(_) => (true, None),
            Err(e) => (false, Some(e.clone())),
        };

        let progress = BatchProgress {
            index: i,
            total,
            title: url.clone(),
            success,
            error,
        };

        let _ = app_handle.emit("batch_download_progress", &progress);
    }
    Ok(())
}

// ── Local file management ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct LocalTrack {
    title: String,
    path: String,
    size_bytes: u64,
    extension: String,
}

#[tauri::command]
async fn scan_downloads(path: String) -> Result<Vec<LocalTrack>, String> {
    tokio::task::spawn_blocking(move || {
        let resolved = expand_tilde(&path);
        let extensions = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma"];
        let mut tracks: Vec<LocalTrack> = Vec::new();

        let dir = std::fs::read_dir(&resolved)
            .map_err(|e| format!("Cannot read directory: {}", e))?;

        for entry in dir.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if extensions.contains(&ext.to_lowercase().as_str()) {
                        let title = p.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Unknown")
                            .to_string();
                        let full_path = p.to_string_lossy().to_string();
                        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        tracks.push(LocalTrack {
                            title,
                            path: full_path,
                            size_bytes: size,
                            extension: ext.to_lowercase(),
                        });
                    }
                }
            }
        }

        tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(tracks)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_local_file(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Delete failed: {}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn rename_local_file(old_path: String, new_title: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let old = std::path::Path::new(&old_path);
        let parent = old.parent().ok_or("No parent directory")?;
        let ext = old.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp3");
        // Sanitize: remove characters invalid in filenames
        let safe_title: String = new_title
            .chars()
            .map(|c| if r#"/\:*?"<>|"#.contains(c) { '_' } else { c })
            .collect();
        let new_path = parent.join(format!("{}.{}", safe_title, ext));
        std::fs::rename(&old_path, &new_path)
            .map_err(|e| format!("Rename failed: {}", e))?;
        Ok(new_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_in_file_manager(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        // If it's a file, open its parent directory
        let dir = if p.is_file() {
            p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or(path)
        } else {
            path
        };

        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(&dir).spawn()
                .map_err(|e| format!("open failed: {}", e))?;
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer.exe").arg(&dir).spawn()
                .map_err(|e| format!("explorer failed: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open").arg(&dir).spawn()
                .map_err(|e| format!("xdg-open failed: {}", e))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Audio metadata (ffprobe) ──────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AudioMetadata {
    title: String,
    artist: String,
    album: String,
    duration: String,
}

#[tauri::command]
async fn get_audio_metadata(path: String) -> Result<AudioMetadata, String> {
    tokio::task::spawn_blocking(move || {
        let output = Command::new("ffprobe")
            .args([
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                &path,
            ])
            .output()
            .map_err(|_| "ffprobe not found — install ffmpeg".to_string())?;

        let json_str = String::from_utf8_lossy(&output.stdout).to_string();
        let json: Value = serde_json::from_str(&json_str).unwrap_or(Value::Null);
        let tags = &json["format"]["tags"];

        let duration_secs = json["format"]["duration"]
            .as_str()
            .and_then(|d| d.parse::<f64>().ok())
            .unwrap_or(0.0);

        let mins = (duration_secs as u64) / 60;
        let secs = (duration_secs as u64) % 60;
        let duration_str = format!("{}:{:02}", mins, secs);

        let title = tags["title"].as_str()
            .or_else(|| tags["TITLE"].as_str())
            .unwrap_or("")
            .to_string();
        let artist = tags["artist"].as_str()
            .or_else(|| tags["ARTIST"].as_str())
            .or_else(|| tags["album_artist"].as_str())
            .unwrap_or("")
            .to_string();
        let album = tags["album"].as_str()
            .or_else(|| tags["ALBUM"].as_str())
            .unwrap_or("")
            .to_string();

        Ok(AudioMetadata { title, artist, album, duration: duration_str })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Waveform thumbnail ────────────────────────────────────────────────────────
// Shells out to ffmpeg to get a downsampled amplitude envelope as a Vec<f32>.
// Used by the Downloads page to render a visual waveform behind the progress bar.

#[tauri::command]
async fn get_waveform_thumbnail(path: String) -> Result<Vec<f32>, String> {
    tokio::task::spawn_blocking(move || {
        // ffmpeg -i <file> -af "aresample=500,astats=metadata=1:reset=1" -f null -
        // We use the showwavespic approach instead: extract raw PCM at very low rate
        // then compute RMS per chunk. Pure ffmpeg, no extra deps.
        let output = Command::new("ffmpeg")
            .args([
                "-i", &path,
                "-ac", "1",                // mono
                "-ar", "500",              // 500 samples/sec  → ~1 value per 2ms
                "-f", "f32le",             // raw 32-bit float little-endian
                "-",                       // stdout
            ])
            .output()
            .map_err(|_| "ffmpeg not found".to_string())?;

        if output.stdout.is_empty() {
            return Err("No audio data".to_string());
        }

        // Parse raw f32le bytes
        let samples: Vec<f32> = output.stdout
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]).abs())
            .collect();

        // Downsample to at most 200 points for the frontend
        let target = 200usize;
        let chunk_size = (samples.len() / target).max(1);
        let envelope: Vec<f32> = samples
            .chunks(chunk_size)
            .take(target)
            .map(|chunk| {
                let rms = (chunk.iter().map(|&x| x * x).sum::<f32>() / chunk.len() as f32).sqrt();
                rms
            })
            .collect();

        Ok(envelope)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Disk usage ────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct DiskInfo {
    used_bytes: u64,
    track_count: usize,
}

#[tauri::command]
async fn get_disk_usage(path: String) -> Result<DiskInfo, String> {
    tokio::task::spawn_blocking(move || {
        let resolved = expand_tilde(&path);
        let extensions = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma"];

        let dir = std::fs::read_dir(&resolved)
            .map_err(|e| format!("Cannot read directory: {}", e))?;

        let mut used_bytes = 0u64;
        let mut track_count = 0usize;

        for entry in dir.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if extensions.contains(&ext.to_lowercase().as_str()) {
                        used_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                        track_count += 1;
                    }
                }
            }
        }

        Ok(DiskInfo { used_bytes, track_count })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Playlist M3U export / import ──────────────────────────────────────────────

#[tauri::command]
async fn export_playlist_m3u(
    tracks: Vec<TrackExport>,
    path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let resolved = expand_tilde(&path);
        let mut content = String::from("#EXTM3U\n");
        for t in &tracks {
            content.push_str(&format!(
                "#EXTINF:{},{} - {}\n{}\n",
                t.duration_secs,
                t.artist,
                t.title,
                t.url
            ));
        }
        std::fs::write(&resolved, content)
            .map_err(|e| format!("Write failed: {}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct TrackExport {
    title: String,
    artist: String,
    url: String,
    duration_secs: i64,
}

#[tauri::command]
async fn import_playlist_m3u(path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let resolved = expand_tilde(&path);
        let content = std::fs::read_to_string(&resolved)
            .map_err(|e| format!("Read failed: {}", e))?;
        let urls: Vec<String> = content
            .lines()
            .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect();
        Ok(urls)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Audio normalization ───────────────────────────────────────────────────────

#[tauri::command]
async fn normalize_file(path: String, output_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let resolved_in = expand_tilde(&path);
        let resolved_out = expand_tilde(&output_path);

        let out = Command::new("ffmpeg")
            .args([
                "-i", &resolved_in,
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ar", "44100",
                "-y",               // overwrite output
                &resolved_out,
            ])
            .output()
            .map_err(|_| "ffmpeg not found".to_string())?;

        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Sleep timer ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn set_sleep_timer(seconds: u64) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(seconds);
    let gen = { let mut g = SLEEP_TIMER_GEN.lock().unwrap(); *g += 1; *g };
    *SLEEP_TIMER.lock().unwrap() = Some((deadline, gen));

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
        let cur_gen = *SLEEP_TIMER_GEN.lock().unwrap();
        let fire = SLEEP_TIMER.lock().unwrap()
            .map(|(d, g)| g == gen && g == cur_gen && d <= std::time::Instant::now())
            .unwrap_or(false);
        if fire {
            let _ = tokio::task::spawn_blocking(|| {
                send_ipc_command_with_retry(r#"{"command": ["set_property", "pause", true]}"#, 2)
            }).await;
            *SLEEP_TIMER.lock().unwrap() = None;
        }
    });
    Ok(())
}

#[tauri::command]
async fn cancel_sleep_timer() -> Result<(), String> {
    *SLEEP_TIMER_GEN.lock().unwrap() += 1; // invalidate any in-flight timer task
    *SLEEP_TIMER.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn get_sleep_timer_remaining() -> Result<i64, String> {
    let remaining = SLEEP_TIMER.lock().unwrap().map(|(deadline, _)| {
        let now = std::time::Instant::now();
        if deadline > now { (deadline - now).as_secs() as i64 } else { 0 }
    }).unwrap_or(-1);
    Ok(remaining)
}

// ── Platform helpers ──────────────────────────────────────────────────────────


// ── Wait for IPC socket to become connectable ────────────────────────────────
fn wait_for_socket(timeout_ms: u64) {
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_millis(timeout_ms);
    #[cfg(unix)]
    {
        while std::time::Instant::now() < deadline {
            if std::path::Path::new(SOCKET_PATH).exists() {
                // Try a real connect to confirm it's listening
                if UnixStream::connect(SOCKET_PATH).is_ok() { return; }
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    }
    #[cfg(windows)]
    {
        while std::time::Instant::now() < deadline {
            if OpenOptions::new().read(true).write(true).open(SOCKET_PATH).is_ok() { return; }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    }
}

fn kill_mpv() {
    #[cfg(unix)]
    {
        // Scope to current user only — prevents killing other users' mpv (vuln #14)
        let uid = unsafe { libc_getuid() }.to_string();
        let _ = Command::new("pkill").args(["-KILL", "-u", &uid, "mpv"]).output();
    }
    #[cfg(windows)]
    { let _ = Command::new("taskkill").args(["/F", "/IM", "mpv.exe"]).output(); }
}

fn cleanup_socket() {
    #[cfg(unix)]
    {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::path::Path::new(SOCKET_PATH).exists()
            && std::time::Instant::now() < deadline
        {
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        let _ = std::fs::remove_file(SOCKET_PATH);
    }
    #[cfg(windows)]
    {
        // Poll until the named pipe is gone (open-attempt fails = pipe released)
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            let gone = OpenOptions::new()
                .read(true)
                .write(true)
                .open(SOCKET_PATH)
                .is_err();
            if gone { break; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

// ── IPC helpers ───────────────────────────────────────────────────────────────

fn send_ipc_command_with_retry(cmd: &str, retries: u8) -> Result<String, String> {
    let mut last_err = String::new();
    for attempt in 0..=retries {
        match send_ipc_command(cmd) {
            Ok(r) => return Ok(r),
            Err(e) => {
                last_err = e;
                if attempt < retries {
                    // Exponential-ish back-off: 50ms → 100ms → 200ms
                    let delay = 50u64 * (1u64 << attempt.min(4));
                    std::thread::sleep(std::time::Duration::from_millis(delay));
                }
            }
        }
    }
    Err(last_err)
}

fn send_ipc_command(cmd: &str) -> Result<String, String> {
    // Drain mpv unsolicited events until we get our command response (vuln #11 fix)
    // mpv events have "event" key; command responses have "error" key
    fn is_cmd_response(line: &str) -> bool {
        let v: Value = serde_json::from_str(line).unwrap_or(Value::Null);
        !v.is_null() && !v["error"].is_null()
    }

    #[cfg(unix)]
    {
        let stream = UnixStream::connect(SOCKET_PATH)
            .map_err(|e| format!("IPC connect failed: {}", e))?;
        stream.set_read_timeout(Some(std::time::Duration::from_millis(800)))
            .map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(std::time::Duration::from_millis(400)))
            .map_err(|e| e.to_string())?;
        let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
        writer.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
        writer.write_all(b"\n").map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(stream);
        for _ in 0..24 {
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() || line.is_empty() { break; }
            if is_cmd_response(line.trim()) { return Ok(line); }
        }
        Err("No response from mpv".to_string())
    }

    #[cfg(windows)]
    {
        let file = OpenOptions::new()
            .read(true).write(true)
            .open(SOCKET_PATH)
            .map_err(|e| format!("IPC connect failed: {}", e))?;
        {
            use std::io::Write;
            let mut f = &file;
            f.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
            f.write_all(b"\n").map_err(|e| e.to_string())?;
        }
        let mut reader = BufReader::new(&file);
        for _ in 0..24 {
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() || line.is_empty() { break; }
            if is_cmd_response(line.trim()) { return Ok(line); }
        }
        Err("No response from mpv".to_string())
    }
}

fn parse_f64_from_response(response: &str) -> Result<f64, String> {
    let json: Value = serde_json::from_str(response).map_err(|e| e.to_string())?;
    if json["data"].is_null() { return Ok(0.0); }
    json["data"].as_f64()
        .ok_or_else(|| format!("Unexpected data type: {}", response))
}

// ── Install dependencies ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct InstallResult {
    success: bool,
    message: String,
}

#[tauri::command]
async fn install_dependencies(_app_handle: tauri::AppHandle) -> Result<InstallResult, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            // Detect package manager and install
            let pkg_managers: &[(&str, &[&str], &[&str])] = &[
                ("apt-get", &["apt-get", "install", "-y", "mpv", "ffmpeg", "python3-pip"], &["pip3", "install", "--upgrade", "yt-dlp", "spotdl"]),
                ("pacman",  &["pacman", "--noconfirm", "-S", "mpv", "ffmpeg"],             &["pip3", "install", "--upgrade", "yt-dlp", "spotdl"]),
                ("dnf",     &["dnf", "install", "-y", "mpv", "ffmpeg"],                    &["pip3", "install", "--upgrade", "yt-dlp", "spotdl"]),
                ("zypper",  &["zypper", "install", "-y", "mpv", "ffmpeg"],                 &["pip3", "install", "--upgrade", "yt-dlp", "spotdl"]),
            ];

            let mut installed = false;
            let mut log = String::new();

            for (mgr, pkg_args, _pip_args) in pkg_managers {
                if Command::new("which").arg(mgr).output().map(|o| o.status.success()).unwrap_or(false) {
                    log.push_str(&format!("Detected package manager: {}\n", mgr));
                    // sudo -n = non-interactive (no password prompt — avoids hanging)
                    // If sudo needs a password, we fall back to running without sudo
                    let result = Command::new("sudo")
                        .args(["-n"])  // non-interactive — fail instead of prompting
                        .args(*pkg_args)
                        .env("DEBIAN_FRONTEND", "noninteractive")
                        .output()
                        .or_else(|_| Command::new(pkg_args[0])
                            .args(&pkg_args[1..])
                            .env("DEBIAN_FRONTEND", "noninteractive")
                            .output());
                    match result {
                        Ok(out) => {
                            log.push_str(&String::from_utf8_lossy(&out.stdout));
                            log.push_str(&String::from_utf8_lossy(&out.stderr));
                            if out.status.success() { installed = true; }
                            else {
                                log.push_str(&format!("\nNote: package install may need sudo password.\nRun manually: sudo {} {}\n",
                                    pkg_args[0], pkg_args[1..].join(" ")));
                            }
                        }
                        Err(e) => { log.push_str(&format!("Error with {}: {}\n", mgr, e)); }
                    }
                    break;
                }
            }
            if !installed {
                log.push_str("No supported package manager found (apt, pacman, dnf, zypper).\n");
            }

            // Install yt-dlp and spotdl via pip3 (no sudo needed — user install)
            log.push_str("\nInstalling yt-dlp and spotdl via pip...\n");
            for pip in &["pip3", "pip"] {
                if let Ok(out) = Command::new(pip).args(["install", "--upgrade", "--user", "yt-dlp", "spotdl"]).output() {
                    log.push_str(&String::from_utf8_lossy(&out.stdout));
                    if out.status.success() { break; }
                }
            }
            // Also try python3 -m pip
            if !Command::new("yt-dlp").arg("--version").output().is_ok() {
                let _ = Command::new("python3").args(["-m", "pip", "install", "--upgrade", "--user", "yt-dlp", "spotdl"]).output();
            }

            // Re-check what's available now
            let mpv = Command::new("mpv").arg("--version").output().is_ok();
            let yt_dlp = Command::new("yt-dlp").arg("--version").output().is_ok();
            let ffprobe = Command::new("ffprobe").arg("-version").output().is_ok();

            let spotdl = Command::new("spotdl").arg("--version").output().is_ok();
            let msg = format!(
                "Installation complete.\nmpv: {}  yt-dlp: {}  ffprobe: {}  spotdl: {}\n{}",
                if mpv { "✓" } else { "✗ (install manually)" },
                if yt_dlp { "✓" } else { "✗ (run: pip3 install yt-dlp)" },
                if ffprobe { "✓" } else { "✗ (part of ffmpeg)" },
                if spotdl { "✓" } else { "✗ (run: pip3 install spotdl)" },
                if !installed { "No supported package manager found. Install manually." } else { "" }
            );
            Ok(InstallResult { success: mpv || yt_dlp, message: msg })
        }

        #[cfg(target_os = "windows")]
        {
            let mut log = String::new();
            let mut success = false;

            // Try winget first (available on Windows 10 1709+)
            let winget_ok = Command::new("winget")
                .args(["install", "--id", "mpv.net", "-e", "--accept-source-agreements", "--accept-package-agreements"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);

            if winget_ok {
                // Install ffmpeg
                let _ = Command::new("winget")
                    .args(["install", "--id", "Gyan.FFmpeg", "-e", "--accept-source-agreements", "--accept-package-agreements"])
                    .output();
                success = true;
                log.push_str("Installed via winget.\n");
            } else {
                // Try chocolatey
                let choco_ok = Command::new("choco")
                    .args(["install", "mpv", "ffmpeg", "-y"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if choco_ok {
                    success = true;
                    log.push_str("Installed via chocolatey.\n");
                } else {
                    log.push_str("winget and chocolatey not found.\nPlease install manually:\n- mpv: https://mpv.io/installation/\n- yt-dlp: https://github.com/yt-dlp/yt-dlp\n- ffmpeg: https://ffmpeg.org/download.html\n");
                }
            }

            // Install yt-dlp and spotdl via pip
            let _ = Command::new("pip").args(["install", "--upgrade", "yt-dlp", "spotdl"]).output();
            let _ = Command::new("pip3").args(["install", "--upgrade", "yt-dlp", "spotdl"]).output();
            let _ = Command::new("python").args(["-m", "pip", "install", "--upgrade", "yt-dlp", "spotdl"]).output();
            // Or winget for yt-dlp
            let _ = Command::new("winget")
                .args(["install", "--id", "yt-dlp.yt-dlp", "-e", "--accept-source-agreements", "--accept-package-agreements"])
                .output();

            let mpv = Command::new("mpv").arg("--version").output().is_ok();
            let yt_dlp = Command::new("yt-dlp").arg("--version").output().is_ok();
            let ffprobe = Command::new("ffprobe").arg("-version").output().is_ok();

            let spotdl = Command::new("spotdl").arg("--version").output().is_ok();
            let msg = format!(
                "{}\nmpv: {}  yt-dlp: {}  ffprobe: {}  spotdl: {}",
                log,
                if mpv { "✓" } else { "✗ (restart may be needed)" },
                if yt_dlp { "✓" } else { "✗ (restart may be needed)" },
                if ffprobe { "✓" } else { "✗" },
                if spotdl { "✓" } else { "✗ (restart may be needed)" }
            );

            Ok(InstallResult { success, message: msg })
        }

        // macOS not supported
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        { Ok(InstallResult { success: false, message: "Unsupported platform".to_string() }) }
    })
    .await
    .map_err(|e| e.to_string())?
}


// ── Discord RPC ───────────────────────────────────────────────────────────────
// Connects to the local Discord IPC socket and sends Rich Presence updates.
// Discord exposes a local socket — no HTTP, no API keys, just JSON over IPC.
// App: "Vanguard Music" | Client ID: 1480119572941111388 | Asset key: "icon"

const DISCORD_CLIENT_ID: u64 = 1480119572941111388;

lazy_static::lazy_static! {
    // Tracks whether we currently have a live Discord IPC connection
    static ref DISCORD_CONNECTED: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
    // Tracks the start timestamp of the current track (Unix seconds)
    static ref DISCORD_TRACK_START: Arc<Mutex<Option<u64>>> = Arc::new(Mutex::new(None));
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Encode a Discord IPC frame: 4-byte LE opcode + 4-byte LE length + JSON payload
fn discord_frame(opcode: u32, payload: &str) -> Vec<u8> {
    let bytes = payload.as_bytes();
    let len = bytes.len() as u32;
    let mut frame = Vec::with_capacity(8 + bytes.len());
    frame.extend_from_slice(&opcode.to_le_bytes());
    frame.extend_from_slice(&len.to_le_bytes());
    frame.extend_from_slice(bytes);
    frame
}

/// Read one IPC frame from Discord (opcode + length prefix)
fn discord_read_frame(stream: &mut dyn std::io::Read) -> Result<(u32, String), String> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header).map_err(|e| e.to_string())?;
    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok((opcode, String::from_utf8_lossy(&body).to_string()))
}

#[cfg(unix)]
fn discord_connect() -> Result<UnixStream, String> {
    // Discord tries sockets 0..9: /tmp/discord-ipc-0 .. /tmp/discord-ipc-9
    // Also check XDG_RUNTIME_DIR and snap/flatpak paths
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    let snap_dir = format!("/run/user/{}/snap.discord", unsafe { libc_getuid() });
    let flatpak_dir = format!("{}/app/com.discordapp.Discord", runtime_dir);

    for i in 0..10u8 {
        for base in &[runtime_dir.as_str(), "/tmp", snap_dir.as_str(), flatpak_dir.as_str()] {
            let path = format!("{}/discord-ipc-{}", base, i);
            if let Ok(stream) = UnixStream::connect(&path) {
                return Ok(stream);
            }
        }
    }
    Err("Discord IPC socket not found — is Discord running?".to_string())
}

#[cfg(unix)]
fn libc_getuid() -> u32 {
    extern "C" { fn getuid() -> u32; }
    unsafe { getuid() }
}

#[cfg(windows)]
fn discord_connect() -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    for i in 0..10u8 {
        let path = format!(r"\\.\pipe\discord-ipc-{}", i);
        if let Ok(f) = OpenOptions::new().read(true).write(true).open(&path) {
            return Ok(f);
        }
    }
    Err("Discord pipe not found — is Discord running?".to_string())
}

/// Perform the Discord IPC handshake and send a SET_ACTIVITY payload.
/// Returns Ok(()) if the update was sent, Err if Discord is not running or connection failed.
fn discord_send_activity(title: &str, artist: &str, start_ts: u64) -> Result<(), String> {
    #[cfg(unix)]
    let mut stream = discord_connect()?;
    #[cfg(windows)]
    let mut stream = discord_connect()?;

    // Opcode 0 = HANDSHAKE
    let handshake = format!(r#"{{"v":1,"client_id":"{}"}}"#, DISCORD_CLIENT_ID);
    stream.write_all(&discord_frame(0, &handshake)).map_err(|e| e.to_string())?;

    // Read handshake response (opcode 1 = FRAME)
    discord_read_frame(&mut stream).map_err(|_| "Handshake read failed".to_string())?;

    // Nonce = current unix ms as string (just needs to be unique)
    let nonce = unix_now().to_string();

    // Truncate title/artist to 128 chars (Discord limit), min 2 chars
    let title_safe = if title.len() < 2 { format!("{:.<2}", title) } else { title.chars().take(128).collect::<String>() };
    let artist_safe = if artist.len() < 2 { format!("{:.<2}", artist) } else { artist.chars().take(128).collect::<String>() };

    // Use json_escape for safe JSON — prevents IPC injection (CRITICAL #2)
    // small_image removed — no more duplicate icon in Discord RPC
    // TODO: Replace the download URL with your actual release URL
    let activity = format!(
        r#"{{"jsonrpc":"2.0","id":1,"cmd":"SET_ACTIVITY","args":{{"pid":{},"activity":{{"type":2,"details":"{}","state":"{}","timestamps":{{"start":{}}},"assets":{{"large_image":"icon","large_text":"Vanguard Music"}},"buttons":[{{"label":"Download Vanguard","url":"https://github.com/your-repo/vanguard-player"}}],"instance":false}}}},"nonce":"{}"}}"#,
        std::process::id(),
        json_escape(&title_safe),
        json_escape(&artist_safe),
        start_ts,
        nonce
    );

    // Opcode 1 = FRAME
    stream.write_all(&discord_frame(1, &activity)).map_err(|e| e.to_string())?;
    // Read response (we don't need it but must drain it)
    let _ = discord_read_frame(&mut stream);

    Ok(())
}

fn discord_clear_activity() {
    #[cfg(unix)]
    let stream_result = discord_connect();
    #[cfg(windows)]
    let stream_result = discord_connect();

    if let Ok(mut stream) = stream_result {
        let handshake = format!(r#"{{"v":1,"client_id":"{}"}}"#, DISCORD_CLIENT_ID);
        let _ = stream.write_all(&discord_frame(0, &handshake));
        let _ = discord_read_frame(&mut stream);
        let clear = format!(
            r#"{{"jsonrpc":"2.0","id":2,"cmd":"SET_ACTIVITY","args":{{"pid":{},"activity":null}},"nonce":"clear"}}"#,
            std::process::id()
        );
        let _ = stream.write_all(&discord_frame(1, &clear));
        let _ = discord_read_frame(&mut stream);
    }
}

#[tauri::command]
async fn update_discord_rpc(title: String, artist: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let start_ts = {
            let mut ts = DISCORD_TRACK_START.lock().unwrap();
            let now = unix_now();
            *ts = Some(now);
            now
        };
        discord_send_activity(&title, &artist, start_ts)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clear_discord_rpc() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        discord_clear_activity();
        *DISCORD_TRACK_START.lock().unwrap() = None;
    })
    .await
    .map_err(|e| e.to_string())
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tauri::command]
fn ping() -> String { "pong".to_string() }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Debug
            ping,
            // Dependencies
            check_dependencies,
            install_dependencies,
            get_yt_dlp_version,
            update_yt_dlp,
            // Search & prefetch
            search_youtube,
            search_spotify_playlist,
            prefetch_track,
            // spotdl
            get_spotdl_version,
            update_spotdl,
            install_spotdl,
            // Stream cache
            set_cache_dir,
            get_cache_dir,
            get_cache_size,
            clear_cache,
            // Playback
            play_audio,
            play_local_file,
            pause_audio,
            seek_audio,
            seek_relative,
            seek_to_start,
            set_volume,
            get_progress,
            get_duration,
            is_paused,
            get_playback_state,
            set_playback_speed,
            get_playback_speed,
            set_pitch,
            get_audio_info,
            set_equalizer,
            // Sleep timer
            set_sleep_timer,
            cancel_sleep_timer,
            get_sleep_timer_remaining,
            // Downloads
            download_song,
            batch_download,
            scan_downloads,
            delete_local_file,
            rename_local_file,
            open_in_file_manager,
            get_audio_metadata,
            get_waveform_thumbnail,
            get_disk_usage,
            // Playlists
            export_playlist_m3u,
            import_playlist_m3u,
            // Normalization
            normalize_file,
            // Discord RPC
            update_discord_rpc,
            clear_discord_rpc,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                kill_mpv();
                discord_clear_activity();
                #[cfg(unix)]
                { let _ = std::fs::remove_file(SOCKET_PATH); }
            }
        });
}