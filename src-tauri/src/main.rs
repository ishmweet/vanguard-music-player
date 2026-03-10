use std::fmt::Write as FmtWrite;
use std::io::{Write, BufRead, BufReader};
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

    static ref SLEEP_TIMER: Arc<Mutex<Option<(std::time::Instant, u64)>>> =
        Arc::new(Mutex::new(None));
    static ref SLEEP_TIMER_GEN: Arc<Mutex<u64>> = Arc::new(Mutex::new(0));

    static ref STREAM_CACHE_DIR: Arc<Mutex<String>> =
        Arc::new(Mutex::new(default_cache_dir()));

    // When false the --af flag is omitted entirely from mpv args. [C4]
    // mpv rejects `--af=` (empty value) on most builds.
    static ref LOUDNORM_ENABLED: Arc<Mutex<bool>> = Arc::new(Mutex::new(true));
}

fn default_cache_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        // LOCALAPPDATA = C:\Users\<n>\AppData\Local
        // Does not sync to OneDrive; excluded from system backups.
        std::env::var("LOCALAPPDATA")
            .map(|h| format!("{}\\Vanguard\\Cache", h))
            .or_else(|_| std::env::var("APPDATA").map(|h| format!("{}\\Vanguard\\Cache", h)))
            .unwrap_or_else(|_| "C:\\Users\\Public\\AppData\\Vanguard\\Cache".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .map(|h| format!("{}/Documents/VanguardCache", h))
            .unwrap_or_else(|_| "/tmp/VanguardCache".to_string())
    }
}

// ── Path / URL helpers ────────────────────────────────────────────────────────

fn expand_tilde(path: &str) -> String {
    if path == "~" || path.starts_with("~/") || path.starts_with("~\\") {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        return path.replacen('~', &home, 1);
    }
    path.to_string()
}

fn sanitize_stream_url(url: &str) -> Result<String, String> {
    let u = url.trim();
    if u.starts_with("https://") || u.starts_with("http://") {
        Ok(u.to_string())
    } else {
        Err(format!("Rejected URL with unsafe scheme: {}", &u[..u.len().min(80)]))
    }
}

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

// [C1] write!() requires FmtWrite (std::fmt::Write) in scope.
// The global `use std::io::Write` is a different trait and does NOT satisfy this.
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '"'  => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => { let _ = write!(out, "\\u{:04x}", c as u32); }
            c => out.push(c),
        }
    }
    out
}

fn safe_f64(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

// ── Helper: Find command in PATH and common Homebrew paths ───────────────────

fn find_command(cmd: &str) -> String {
    // Try direct command first
    if Command::new("which").arg(cmd).output()
        .map(|o| o.status.success()).unwrap_or(false) {
        return cmd.to_string();
    }
    
    // Try Homebrew paths on macOS
    #[cfg(target_os = "macos")]
    {
        for base_path in &["/opt/homebrew/bin", "/usr/local/bin"] {
            let full_path = format!("{}/{}", base_path, cmd);
            if std::path::Path::new(&full_path).exists() {
                return full_path;
            }
        }
    }
    
    // Fallback to command name (will fail gracefully later)
    cmd.to_string()
}

// ── Dependency checker ────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct DepsStatus { mpv: bool, yt_dlp: bool, ffprobe: bool }

#[tauri::command]
async fn check_dependencies() -> Result<DepsStatus, String> {
    tokio::task::spawn_blocking(|| {
        let check_cmd = |cmd: &str| -> bool {
            let path = find_command(cmd);
            if let Ok(out) = Command::new(&path).arg("--version").output() {
                if out.status.success() {
                    return true;
                }
            }
            if let Ok(out) = Command::new(&path).arg("-version").output() {
                if out.status.success() {
                    return true;
                }
            }
            false
        };
        
        let mpv     = check_cmd("mpv");
        let yt_dlp  = check_cmd("yt-dlp");
        let ffprobe = check_cmd("ffprobe");
        Ok(DepsStatus { mpv, yt_dlp, ffprobe })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── yt-dlp version / update ───────────────────────────────────────────────────

#[tauri::command]
async fn get_yt_dlp_version() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        // Try direct command first
        if let Ok(out) = Command::new("yt-dlp").arg("--version").output() {
            if out.status.success() {
                return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
            }
        }
        
        // Try Homebrew paths
        #[cfg(target_os = "macos")]
        {
            for base_path in &["/opt/homebrew/bin", "/usr/local/bin"] {
                let full_path = format!("{}/yt-dlp", base_path);
                if let Ok(out) = Command::new(&full_path).arg("--version").output() {
                    if out.status.success() {
                        return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
                    }
                }
            }
        }
        
        Err("yt-dlp not found".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_yt_dlp() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let yt_dlp_cmd = "yt-dlp";
        
        // Try Homebrew paths first on macOS
        #[cfg(target_os = "macos")]
        {
            for base_path in &["/opt/homebrew/bin", "/usr/local/bin"] {
                let full_path = format!("{}/yt-dlp", base_path);
                if let Ok(out) = Command::new(&full_path).arg("-U").output() {
                    if out.status.success() || !out.stdout.is_empty() {
                        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                        return Ok(if stdout.trim().is_empty() { stderr } else { stdout });
                    }
                }
            }
        }
        
        // Fall back to direct command
        let out = Command::new(yt_dlp_cmd).arg("-U")
            .output().map_err(|_| "yt-dlp not found".to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Ok(if stdout.trim().is_empty() { stderr } else { stdout })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── YouTube search ────────────────────────────────────────────────────────────

#[tauri::command]
async fn search_youtube(query: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let yt_dlp_path = find_command("yt-dlp");
        let mut child = Command::new(&yt_dlp_path)
            .args([
                &format!("ytsearch10:{}", query),
                "--flat-playlist",
                "--print", "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
                "--no-warnings",
                "--no-check-certificates",
                "--socket-timeout", "8",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        // Hard 15s kill — prevents hang on bad network.
        // kill+wait path returns immediately; wait_with_output only on normal exit.
        // (Calling wait_with_output on an already-waited process would panic.)
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if std::time::Instant::now() > deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("Search timed out — check your connection".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.trim().is_empty() {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            return Err(if stderr.trim().is_empty() { "No results found".to_string() } else { stderr });
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Open URL in browser ───────────────────────────────────────────────────────

#[tauri::command]
async fn open_url_in_browser(url: String) -> Result<(), String> {
    let sanitized = url.trim().to_string();
    if !sanitized.starts_with("https://") && !sanitized.starts_with("http://") {
        return Err("Only http/https URLs are allowed".to_string());
    }
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        { Command::new("xdg-open").arg(&sanitized).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "macos")]
        { Command::new("open").arg(&sanitized).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "windows")]
        { Command::new("cmd").args(["/c", "start", "", &sanitized]).spawn().map_err(|e| e.to_string())?; }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── YouTube playlist import ───────────────────────────────────────────────────

#[tauri::command]
async fn import_youtube_playlist(url: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut child = Command::new("yt-dlp")
            .args([
                "--flat-playlist",
                "--no-warnings",
                "--ignore-errors",
                "--socket-timeout", "10",
                "--print", "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
                "--",
                url.as_str(),
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        // 60s hard kill — large playlists can legitimately take ~45s
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if std::time::Instant::now() > deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("Playlist import timed out — check the URL and your connection".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.trim().is_empty() {
            return Err("No tracks found. Is this a public playlist?".to_string());
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── CSV Playlist import ───────────────────────────────────────────────────────

#[tauri::command]
async fn import_csv_playlist(csv_content: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut lines = csv_content.lines();
        let header = lines.next().unwrap_or("").to_lowercase();
        let cols: Vec<&str> = header.split(',').collect();
        let find_col = |names: &[&str]| -> Option<usize> {
            cols.iter().position(|c| names.iter().any(|n| c.contains(n)))
        };
        let title_idx  = find_col(&["track name", "title", "name"]).unwrap_or(2);
        let artist_idx = find_col(&["artist name", "artist(s)", "artists"]).unwrap_or(4);

        let mut output = String::from("PLAYLIST:Spotify Import\n");
        let mut count = 0usize;
        for line in lines {
            if line.trim().is_empty() { continue; }
            let fields = parse_csv_row(line);
            let title  = fields.get(title_idx).map(|s| s.trim().trim_matches('"').trim()).unwrap_or("").to_string();
            let artist = fields.get(artist_idx).map(|s| s.trim().trim_matches('"').trim()).unwrap_or("").to_string();
            if title.is_empty() { continue; }
            output.push_str(&format!("{}===={}\n", title, artist));
            count += 1;
        }
        if count == 0 {
            return Err("No tracks found in CSV. Make sure this is an Exportify CSV file.".to_string());
        }
        Ok(output)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_csv_row(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    chars.next();
                    current.push('"');
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => { fields.push(current.clone()); current.clear(); }
            _ => current.push(ch),
        }
    }
    fields.push(current);
    fields
}

// ── Prefetch ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn prefetch_track(url: String) -> Result<(), String> {
    if url.starts_with("local://") { return Ok(()); }
    if PREFETCH_CACHE.lock().unwrap().contains_key(&url) { return Ok(()); }
    let cache = Arc::clone(&PREFETCH_CACHE);
    tokio::spawn(async move {
        let url_clone = url.clone();
        let result = tokio::task::spawn_blocking(move || {
            let yt_dlp_path = find_command("yt-dlp");
            Command::new(&yt_dlp_path)
                .args([
                    "--print", "urls",
                    "--format", "bestaudio[ext=webm]/bestaudio/best",
                    "--no-check-certificates",
                    "--no-warnings",
                    "--no-playlist",
                    "--socket-timeout", "8",
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
                c.retain(|_, v| now.duration_since(v.ts) < ttl);
                if c.len() >= 50 { c.clear(); }
                c.insert(url, CacheEntry { url: stream_url, ts: now });
            }
        }
    });
    Ok(())
}

// ── Loudnorm / Cache settings ─────────────────────────────────────────────────

#[tauri::command]
fn set_loudnorm_enabled(enabled: bool) -> Result<(), String> {
    *LOUDNORM_ENABLED.lock().unwrap() = enabled;
    Ok(())
}

#[tauri::command]
fn get_loudnorm_enabled() -> bool {
    *LOUDNORM_ENABLED.lock().unwrap()
}

#[tauri::command]
fn set_cache_dir(path: String) -> Result<(), String> {
    let expanded = expand_tilde(&path);
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

// ── Playback ──────────────────────────────────────────────────────────────────

// [C4] Returns Some("--af=loudnorm=...") when on, None when off.
// Callers push into Vec<String> — never passes an empty --af= to mpv.
fn mpv_af_flag() -> Option<String> {
    if *LOUDNORM_ENABLED.lock().unwrap() {
        Some("--af=loudnorm=I=-16:TP=-1.5:LRA=11".to_string())
    } else {
        None
    }
}

#[tauri::command]
async fn play_audio(url: String) -> Result<(), String> {
    if url.starts_with("local://") {
        return play_local_file(url.trim_start_matches("local://").to_string()).await;
    }
    let safe_url = sanitize_stream_url(&url)?;

    tokio::task::spawn_blocking(move || {
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

        // Find yt-dlp path for mpv's ytdl_hook
        let yt_dlp_path = find_command("yt-dlp");

        // [C4] Build args as Vec so --af is only included when loudnorm is on.
        // `--af=` (empty) causes "Error parsing option af" on most mpv builds.
        let mut args: Vec<String> = vec![
            "--no-video".into(),
            "--cache=yes".into(),
            "--cache-secs=30".into(),
            "--demuxer-max-bytes=32MiB".into(),
            "--demuxer-max-back-bytes=8MiB".into(),
            "--demuxer-readahead-secs=10".into(),
            "--cache-pause=no".into(),
            "--network-timeout=10".into(),
            "--audio-buffer=0.5".into(),
            "--audio-pitch-correction=yes".into(),
        ];
        if let Some(af) = mpv_af_flag() { args.push(af); }
        args.extend([
            format!("--script-opts=ytdl_hook-ytdl_path={}", yt_dlp_path),
            "--ytdl-format=bestaudio[ext=webm]/bestaudio/best".into(),
            "--ytdl-raw-options=ignore-config=,no-check-certificates=,retries=2,fragment-retries=2,concurrent-fragments=4,socket-timeout=10".into(),
            format!("--input-ipc-server={}", SOCKET_PATH),
            "--force-window=no".into(),
            "--keep-open=yes".into(),
            "--idle=yes".into(),
            "--".into(),
            actual_url,
        ]);

        let mpv_path = find_command("mpv");
        Command::new(&mpv_path).args(&args)
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        // [C6] Surface mpv startup failure instead of silently returning Ok(())
        if !wait_for_socket(2500) {
            return Err("mpv failed to start (IPC socket never appeared)".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn play_local_file(path: String) -> Result<(), String> {
    let safe_path = sanitize_file_path(&path)?.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        kill_mpv();
        cleanup_socket();

        // [C4] Same conditional --af — omit entirely when loudnorm is off
        let mut args: Vec<String> = vec![
            "--no-video".into(),
            "--cache=no".into(),
            "--demuxer-max-bytes=1MiB".into(),
            "--audio-buffer=0.1".into(),
            "--audio-pitch-correction=yes".into(),
        ];
        if let Some(af) = mpv_af_flag() { args.push(af); }
        args.extend([
            format!("--input-ipc-server={}", SOCKET_PATH),
            "--force-window=no".into(),
            "--keep-open=yes".into(),
            "--idle=yes".into(),
            "--".into(),
            safe_path,
        ]);

        let mpv_path = find_command("mpv");
        Command::new(&mpv_path).args(&args)
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        // [C6] Local files start fast — 1500ms is generous
        if !wait_for_socket(1500) {
            return Err("mpv failed to start (IPC socket never appeared)".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── IPC — playback control ────────────────────────────────────────────────────

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
        let r = send_ipc_command_with_retry(r#"{"command": ["get_property", "time-pos"]}"#, 2)?;
        parse_f64_from_response(&r)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_duration() -> Result<f64, String> {
    tokio::task::spawn_blocking(|| {
        let r = send_ipc_command_with_retry(r#"{"command": ["get_property", "duration"]}"#, 2)?;
        parse_f64_from_response(&r)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn is_paused() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let r = send_ipc_command_with_retry(r#"{"command": ["get_property", "pause"]}"#, 2)?;
        let j: Value = serde_json::from_str(&r).map_err(|e| e.to_string())?;
        Ok(j["data"].as_bool().unwrap_or(false))
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
    tokio::task::spawn_blocking(|| {
        let responses = send_ipc_batch(&[
            r#"{"command": ["get_property", "pause"]}"#,
            r#"{"command": ["get_property", "time-pos"]}"#,
            r#"{"command": ["get_property", "duration"]}"#,
        ]);

        let pause_resp = responses.get(0)
            .and_then(|r| r.as_ref().ok())
            .cloned()
            .ok_or_else(|| "mpv not running".to_string())?;

        let paused = serde_json::from_str::<Value>(&pause_resp)
            .ok().and_then(|j| j["data"].as_bool()).unwrap_or(false);

        let get_f = |i: usize| responses.get(i)
            .and_then(|r| r.as_ref().ok())
            .and_then(|r| parse_f64_from_response(r).ok())
            .map(safe_f64).unwrap_or(0.0);

        let position = get_f(1);
        let duration  = get_f(2);
        let near_end  = duration > 0.0 && position > 5.0 && (duration - position) < 1.5 && paused;

        Ok(PlaybackState { playing: !paused, paused, position, duration, eof_reached: near_end })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn seek_to_start() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        send_ipc_command_with_retry(r#"{"command": ["seek", 0, "absolute"]}"#, 3).map(|_| ())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        send_ipc_command_with_retry(r#"{"command": ["set_property", "pause", false]}"#, 3).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_playback_speed(speed: f64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let cmd = format!(r#"{{"command": ["set_property", "speed", {}]}}"#, speed);
        send_ipc_command_with_retry(&cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_playback_speed() -> Result<f64, String> {
    tokio::task::spawn_blocking(|| {
        let r = send_ipc_command_with_retry(r#"{"command": ["get_property", "speed"]}"#, 2)?;
        parse_f64_from_response(&r)
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
    channels: String,
    format: String,
    url: String,
}

#[tauri::command]
async fn get_audio_info() -> Result<AudioInfo, String> {
    // [C2] Logic inlined — NOT in a nested fn.
    // Nested fns in Rust cannot capture outer-scope statics (SOCKET_PATH etc.)
    // and produce "cannot find value in this scope" compile errors.
    //
    // [C3] Parse helpers written as direct index access, not nested closures.
    // Two closures both capturing `responses` by-move cause borrow-check failures.
    tokio::task::spawn_blocking(|| {
        let queries: &[&str] = &[
            r#"{"command": ["get_property", "audio-codec-name"]}"#,
            r#"{"command": ["get_property", "audio-bitrate"]}"#,
            r#"{"command": ["get_property", "audio-samplerate"]}"#,
            r#"{"command": ["get_property", "audio-channels"]}"#,
            r#"{"command": ["get_property", "file-format"]}"#,
            r#"{"command": ["get_property", "path"]}"#,
        ];
        // send_ipc_batch handles both Unix (UnixStream) and Windows (named pipe)
        let responses = send_ipc_batch(queries);

        // [C3] Direct helpers — no closure chain over responses
        let raw = |i: usize| -> String {
            responses.get(i).and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default()
        };
        let get_str = |i: usize| -> Option<String> {
            serde_json::from_str::<Value>(&raw(i)).ok()
                .and_then(|j| j["data"].as_str().map(|s| s.to_string()))
        };
        let get_f64_r = |i: usize| -> f64 {
            serde_json::from_str::<Value>(&raw(i)).ok()
                .and_then(|j| j["data"].as_f64())
                .unwrap_or(0.0)
        };

        let codec      = get_str(0).unwrap_or_else(|| "unknown".into());
        let bitrate    = get_f64_r(1);
        let samplerate = get_f64_r(2);
        let channels   = serde_json::from_str::<Value>(&raw(3)).ok()
            .and_then(|j| {
                if let Some(s) = j["data"].as_str() { return Some(s.to_string()); }
                j["data"].as_i64().map(|n| n.to_string())
            })
            .unwrap_or_else(|| "stereo".into());
        let format = get_str(4)
            .map(|s| s.split(',').next().unwrap_or(&s).trim().to_uppercase())
            .unwrap_or_default();
        let url = get_str(5).unwrap_or_default();

        Ok(AudioInfo { codec, bitrate, samplerate, channels, format, url })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Equalizer ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn set_equalizer(bass: f64, mid: f64, treble: f64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let b = bass.clamp(-12.0, 12.0);
        let m = mid.clamp(-12.0, 12.0);
        let t = treble.clamp(-12.0, 12.0);
        let loudnorm_on = *LOUDNORM_ENABLED.lock().unwrap();
        let eq_active   = !(b == 0.0 && m == 0.0 && t == 0.0);

        // [C5] Respect LOUDNORM_ENABLED — do NOT silently re-enable loudnorm.
        // Old code always prepended "loudnorm=..." regardless of the toggle.
        let af_value = match (loudnorm_on, eq_active) {
            (true,  false) => "loudnorm=I=-16:TP=-1.5:LRA=11".to_string(),
            (true,  true)  => format!(
                "loudnorm=I=-16:TP=-1.5:LRA=11,equalizer={b}:{b}:{b}:{b}:{m}:{m}:{m}:{m}:{t}:{t}",
                b=b, m=m, t=t
            ),
            (false, false) => return Ok(()), // nothing to apply
            (false, true)  => format!(
                "equalizer={b}:{b}:{b}:{b}:{m}:{m}:{m}:{m}:{t}:{t}",
                b=b, m=m, t=t
            ),
        };

        let cmd = format!(r#"{{"command": ["set_property", "af", "{}"]}}"#, af_value);
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
        let format = match quality.as_str() {
            "Low"    => "worstaudio/worst",
            "Medium" => "bestaudio[abr<=160]/bestaudio/best",
            _        => "bestaudio/best",
        };
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
        let yt_dlp_path = find_command("yt-dlp");
        let output = Command::new(&yt_dlp_path)
            .args(["-f", format, "--extract-audio", "--audio-format", "mp3",
                   "--audio-quality", audio_quality, "--embed-thumbnail", "--add-metadata",
                   "--no-check-certificates", "--no-warnings", "-o", &output_template, &url])
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

// ── Batch download ────────────────────────────────────────────────────────────

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
        let url_clone     = url.clone();
        let quality_clone = quality.clone();
        let path_clone    = resolved_path.clone();

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
            let yt_dlp_path = find_command("yt-dlp");
            let out = Command::new(&yt_dlp_path)
                .args(["-f", format, "--extract-audio", "--audio-format", "mp3",
                       "--audio-quality", audio_quality, "--embed-thumbnail", "--add-metadata",
                       "--no-check-certificates", "--no-warnings", "-o", &tpl, &url_clone])
                .output()
                .map_err(|e| format!("yt-dlp not found: {}", e))?;
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).to_string())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())?;

        let (success, error) = match &result {
            Ok(_)  => (true, None),
            Err(e) => (false, Some(e.clone())),
        };
        let _ = app_handle.emit("batch_download_progress", &BatchProgress {
            index: i, total, title: url.clone(), success, error,
        });
    }
    Ok(())
}

// ── Local file management ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct LocalTrack { title: String, path: String, size_bytes: u64, extension: String }

#[tauri::command]
async fn scan_downloads(path: String) -> Result<Vec<LocalTrack>, String> {
    tokio::task::spawn_blocking(move || {
        let resolved   = expand_tilde(&path);
        let extensions = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma"];
        let mut tracks: Vec<LocalTrack> = Vec::new();
        let dir = std::fs::read_dir(&resolved)
            .map_err(|e| format!("Cannot read directory: {}", e))?;
        for entry in dir.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if extensions.contains(&ext.to_lowercase().as_str()) {
                        tracks.push(LocalTrack {
                            title:      p.file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown").to_string(),
                            path:       p.to_string_lossy().to_string(),
                            size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
                            extension:  ext.to_lowercase(),
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
        std::fs::remove_file(&path).map_err(|e| format!("Delete failed: {}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn rename_local_file(old_path: String, new_title: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let old    = std::path::Path::new(&old_path);
        let parent = old.parent().ok_or("No parent directory")?;
        let ext    = old.extension().and_then(|e| e.to_str()).unwrap_or("mp3");
        let safe_title: String = new_title.chars()
            .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
            .collect();
        let new_path = parent.join(format!("{}.{}", safe_title, ext));
        std::fs::rename(&old_path, &new_path).map_err(|e| format!("Rename failed: {}", e))?;
        Ok(new_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_in_file_manager(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p   = std::path::Path::new(&path);
        let dir = if p.is_file() {
            p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or(path)
        } else { path };
        #[cfg(target_os = "macos")]
        { Command::new("open").arg(&dir).spawn().map_err(|e| format!("open failed: {}", e))?; }
        #[cfg(target_os = "windows")]
        { Command::new("explorer.exe").arg(&dir).spawn().map_err(|e| format!("explorer failed: {}", e))?; }
        #[cfg(target_os = "linux")]
        { Command::new("xdg-open").arg(&dir).spawn().map_err(|e| format!("xdg-open failed: {}", e))?; }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Audio metadata ────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AudioMetadata { title: String, artist: String, album: String, duration: String }

#[tauri::command]
async fn get_audio_metadata(path: String) -> Result<AudioMetadata, String> {
    tokio::task::spawn_blocking(move || {
        let ffprobe_path = find_command("ffprobe");
        let output = Command::new(&ffprobe_path)
            .args(["-v", "quiet", "-print_format", "json", "-show_format", &path])
            .output()
            .map_err(|_| "ffprobe not found — install ffmpeg".to_string())?;
        let json: Value = serde_json::from_str(
            &String::from_utf8_lossy(&output.stdout)
        ).unwrap_or(Value::Null);
        let tags = &json["format"]["tags"];
        let duration_secs = json["format"]["duration"]
            .as_str().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
        let mins = (duration_secs as u64) / 60;
        let secs = (duration_secs as u64) % 60;
        Ok(AudioMetadata {
            title:    tags["title"].as_str().or_else(|| tags["TITLE"].as_str()).unwrap_or("").to_string(),
            artist:   tags["artist"].as_str().or_else(|| tags["ARTIST"].as_str())
                          .or_else(|| tags["album_artist"].as_str()).unwrap_or("").to_string(),
            album:    tags["album"].as_str().or_else(|| tags["ALBUM"].as_str()).unwrap_or("").to_string(),
            duration: format!("{}:{:02}", mins, secs),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Waveform thumbnail ────────────────────────────────────────────────────────

#[tauri::command]
async fn get_waveform_thumbnail(path: String) -> Result<Vec<f32>, String> {
    tokio::task::spawn_blocking(move || {
        let ffmpeg_path = find_command("ffmpeg");
        let output = Command::new(&ffmpeg_path)
            .args(["-i", &path, "-ac", "1", "-ar", "500", "-f", "f32le", "-"])
            .output()
            .map_err(|_| "ffmpeg not found".to_string())?;
        if output.stdout.is_empty() { return Err("No audio data".to_string()); }
        let samples: Vec<f32> = output.stdout.chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]).abs())
            .collect();
        let target = 200usize;
        let chunk_size = (samples.len() / target).max(1);
        let envelope: Vec<f32> = samples.chunks(chunk_size).take(target)
            .map(|chunk| {
                (chunk.iter().map(|&x| x * x).sum::<f32>() / chunk.len() as f32).sqrt()
            })
            .collect();
        Ok(envelope)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Disk usage ────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct DiskInfo { used_bytes: u64, track_count: usize }

#[tauri::command]
async fn get_disk_usage(path: String) -> Result<DiskInfo, String> {
    tokio::task::spawn_blocking(move || {
        let resolved   = expand_tilde(&path);
        let extensions = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma"];
        let dir = std::fs::read_dir(&resolved)
            .map_err(|e| format!("Cannot read directory: {}", e))?;
        let mut used_bytes  = 0u64;
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

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct TrackExport { title: String, artist: String, url: String, duration_secs: i64 }

#[tauri::command]
async fn export_playlist_m3u(tracks: Vec<TrackExport>, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let resolved = expand_tilde(&path);
        let mut content = String::from("#EXTM3U\n");
        for t in &tracks {
            content.push_str(&format!("#EXTINF:{},{} - {}\n{}\n",
                t.duration_secs, t.artist, t.title, t.url));
        }
        std::fs::write(&resolved, content).map_err(|e| format!("Write failed: {}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_playlist_m3u(path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let resolved = expand_tilde(&path);
        let content = std::fs::read_to_string(&resolved)
            .map_err(|e| format!("Read failed: {}", e))?;
        let urls: Vec<String> = content.lines()
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
        let resolved_in  = expand_tilde(&path);
        let resolved_out = expand_tilde(&output_path);
        let out = Command::new("ffmpeg")
            .args(["-i", &resolved_in, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                   "-ar", "44100", "-y", &resolved_out])
            .output()
            .map_err(|_| "ffmpeg not found".to_string())?;
        if out.status.success() { Ok(()) }
        else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
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
    *SLEEP_TIMER_GEN.lock().unwrap() += 1;
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

// [C6] Returns true if socket became connectable within timeout_ms.
// false = timed out; callers should surface this as a startup error.
fn wait_for_socket(timeout_ms: u64) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    #[cfg(unix)]
    {
        while std::time::Instant::now() < deadline {
            if std::path::Path::new(SOCKET_PATH).exists() {
                if UnixStream::connect(SOCKET_PATH).is_ok() { return true; }
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        false
    }

    #[cfg(windows)]
    {
        // [C7] Plain open — no custom_flags() which requires OpenOptionsExt in scope.
        // Synchronous named pipe open is the correct readiness probe on Windows.
        while std::time::Instant::now() < deadline {
            if OpenOptions::new().read(true).write(true).open(SOCKET_PATH).is_ok() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        false
    }
}

fn kill_mpv() {
    #[cfg(unix)]
    {
        // [C8] user_arg stored as Option<String>. Build Vec<&str> by pushing
        // .as_str() slices into it only while user_arg is still in scope.
        // The original code's extend_from_slice(&["-u", u]) was fine IF u: &str,
        // but if u came from an Option<String> via if-let, the lifetime is tied
        // to that if-let guard. Explicit sequential pushes avoid the ambiguity.
        let user_arg: Option<String> = std::env::var("USER").ok();

        let mut term_args: Vec<&str> = vec!["-TERM"];
        if let Some(ref u) = user_arg {
            term_args.push("-u");
            term_args.push(u.as_str());
        }
        term_args.push("mpv");
        let _ = Command::new("pkill").args(&term_args).output();

        // SIGKILL immediately after SIGTERM.
        // cleanup_socket() polls for socket disappearance, which is the grace period.
        let mut kill_args: Vec<&str> = vec!["-KILL"];
        if let Some(ref u) = user_arg {
            kill_args.push("-u");
            kill_args.push(u.as_str());
        }
        kill_args.push("mpv");
        let _ = Command::new("pkill").args(&kill_args).output();
    }
    #[cfg(windows)]
    {
        // /T kills the process tree (children too), /F forces termination
        let _ = Command::new("taskkill").args(["/F", "/T", "/IM", "mpv.exe"]).output();
    }
}

fn cleanup_socket() {
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(SOCKET_PATH);
        if std::path::Path::new(SOCKET_PATH).exists() {
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(200);
            while std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(10));
                if !std::path::Path::new(SOCKET_PATH).exists() { break; }
            }
            let _ = std::fs::remove_file(SOCKET_PATH);
        }
    }
    #[cfg(windows)]
    {
        // taskkill /F is synchronous — give the Windows pipe subsystem a moment to release
        std::thread::sleep(std::time::Duration::from_millis(30));
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(300);
        while std::time::Instant::now() < deadline {
            if OpenOptions::new().read(true).write(true).open(SOCKET_PATH).is_err() { break; }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
    }
}

// ── IPC helpers ───────────────────────────────────────────────────────────────

// Send N IPC commands over a single socket connection.
// Unix: write all then read all (true pipeline — one connect/disconnect for N cmds).
// Windows: write/read interleaved on a single open handle with persistent BufReader.
fn send_ipc_batch(cmds: &[&str]) -> Vec<Result<String, String>> {
    let n = cmds.len();

    #[cfg(unix)]
    {
        let stream = match UnixStream::connect(SOCKET_PATH) {
            Ok(s) => s,
            Err(e) => return vec![Err(format!("IPC connect failed: {}", e)); n],
        };
        stream.set_read_timeout(Some(std::time::Duration::from_millis(800))).ok();
        stream.set_write_timeout(Some(std::time::Duration::from_millis(400))).ok();

        // Write all commands on a cloned fd before reading any responses.
        // try_clone() duplicates the fd; both the clone and the original share
        // the same underlying socket — writes on the clone are visible when
        // reading from the original BufReader.
        if let Ok(mut w) = stream.try_clone() {
            for cmd in cmds {
                let _ = w.write_all(cmd.as_bytes());
                let _ = w.write_all(b"\n");
            }
        } else {
            return vec![Err("UnixStream clone failed".to_string()); n];
        }

        let mut reader = BufReader::new(stream);
        let mut results: Vec<String> = Vec::with_capacity(n);
        let mut lines_read = 0usize;
        while results.len() < n && lines_read < n * 12 {
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() || line.is_empty() { break; }
            lines_read += 1;
            let trimmed = line.trim();
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                if !v["error"].is_null() { results.push(trimmed.to_string()); }
            }
        }

        let mut out: Vec<Result<String, String>> = results.into_iter().map(Ok).collect();
        while out.len() < n { out.push(Err("No response from mpv".to_string())); }
        out
    }

    #[cfg(not(unix))]
    {
        // Windows: open named pipe once and keep BufReader alive across ALL iterations.
        // Do NOT recreate BufReader per command — that discards buffered bytes and
        // breaks response parsing on subsequent reads.
        let file = match OpenOptions::new().read(true).write(true).open(SOCKET_PATH) {
            Ok(f) => f,
            Err(e) => return vec![Err(format!("IPC connect failed: {}", e)); n],
        };

        let mut reader  = BufReader::new(&file);
        let mut results = Vec::with_capacity(n);
        let deadline    = std::time::Instant::now() + std::time::Duration::from_millis(800);

        for cmd in cmds {
            // Write via &file reference — bypasses BufReader without disturbing its buffer
            {
                let mut w = &file;
                if w.write_all(cmd.as_bytes()).is_err() || w.write_all(b"\n").is_err() { break; }
            }
            let mut found = false;
            for _ in 0..12 {
                if std::time::Instant::now() > deadline { break; }
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() || line.is_empty() { break; }
                let trimmed = line.trim();
                if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                    if !v["error"].is_null() {
                        results.push(trimmed.to_string());
                        found = true;
                        break;
                    }
                }
            }
            if !found { break; }
        }

        let mut out: Vec<Result<String, String>> = results.into_iter().map(Ok).collect();
        while out.len() < n { out.push(Err("No response from mpv".to_string())); }
        out
    }
}

fn send_ipc_command_with_retry(cmd: &str, retries: u8) -> Result<String, String> {
    let mut last_err = String::new();
    for attempt in 0..=retries {
        match send_ipc_command(cmd) {
            Ok(r) => return Ok(r),
            Err(e) => {
                last_err = e;
                if attempt < retries {
                    let delay = 50u64 * (1u64 << attempt.min(4));
                    std::thread::sleep(std::time::Duration::from_millis(delay));
                }
            }
        }
    }
    Err(last_err)
}

fn send_ipc_command(cmd: &str) -> Result<String, String> {
    fn is_cmd_response(line: &str) -> bool {
        let v: Value = serde_json::from_str(line).unwrap_or(Value::Null);
        !v.is_null() && !v["error"].is_null()
    }

    #[cfg(unix)]
    {
        // Write on stream before moving it into BufReader — no try_clone needed.
        // (try_clone + write on clone works too, but this is simpler for the single-cmd case.)
        let mut stream = UnixStream::connect(SOCKET_PATH)
            .map_err(|e| format!("IPC connect failed: {}", e))?;
        stream.set_read_timeout(Some(std::time::Duration::from_millis(500))).map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(std::time::Duration::from_millis(200))).map_err(|e| e.to_string())?;
        stream.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
        stream.write_all(b"\n").map_err(|e| e.to_string())?;
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
        // No native read timeout on Windows named pipes without windows-sys.
        // 600ms iteration deadline guard — mpv responses are near-instant once the
        // pipe is established; this only fires on genuine hangs.
        let file = OpenOptions::new().read(true).write(true)
            .open(SOCKET_PATH)
            .map_err(|e| format!("IPC connect failed: {}", e))?;
        {
            let mut f = &file;
            f.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
            f.write_all(b"\n").map_err(|e| e.to_string())?;
        }
        let mut reader = BufReader::new(&file);
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(600);
        for _ in 0..24 {
            if std::time::Instant::now() > deadline { break; }
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
    json["data"].as_f64().ok_or_else(|| format!("Unexpected data type: {}", response))
}

// ── Install dependencies ──────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct InstallResult { success: bool, message: String }

#[tauri::command]
async fn install_dependencies(_app_handle: tauri::AppHandle) -> Result<InstallResult, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            let pkg_managers: &[(&str, &[&str])] = &[
                ("apt-get", &["apt-get", "install", "-y", "mpv", "ffmpeg", "python3-pip"]),
                ("pacman",  &["pacman", "--noconfirm", "-S", "mpv", "ffmpeg"]),
                ("dnf",     &["dnf", "install", "-y", "mpv", "ffmpeg"]),
                ("zypper",  &["zypper", "install", "-y", "mpv", "ffmpeg"]),
            ];

            let mut installed = false;
            let mut log = String::new();

            for (mgr, pkg_args) in pkg_managers {
                if Command::new("which").arg(mgr).output().map(|o| o.status.success()).unwrap_or(false) {
                    log.push_str(&format!("Detected package manager: {}\n", mgr));
                    let result = Command::new("sudo")
                        .arg("-n").args(*pkg_args)
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
                                log.push_str(&format!("\nNote: may need sudo. Run: sudo {} {}\n",
                                    pkg_args[0], pkg_args[1..].join(" ")));
                            }
                        }
                        Err(e) => log.push_str(&format!("Error with {}: {}\n", mgr, e)),
                    }
                    break;
                }
            }
            if !installed {
                log.push_str("No supported package manager found (apt, pacman, dnf, zypper).\n");
            }

            log.push_str("\nInstalling yt-dlp via pip...\n");
            for pip in &["pip3", "pip"] {
                if let Ok(out) = Command::new(pip).args(["install", "--upgrade", "--user", "yt-dlp"]).output() {
                    log.push_str(&String::from_utf8_lossy(&out.stdout));
                    if out.status.success() { break; }
                }
            }
            if Command::new("yt-dlp").arg("--version").output().is_err() {
                let _ = Command::new("python3").args(["-m", "pip", "install", "--upgrade", "--user", "yt-dlp"]).output();
            }

            let check_cmd = |cmd: &str| -> bool {
                let path = find_command(cmd);
                if let Ok(out) = Command::new(&path).arg("--version").output() {
                    if out.status.success() { return true; }
                }
                if let Ok(out) = Command::new(&path).arg("-version").output() {
                    if out.status.success() { return true; }
                }
                false
            };
            let mpv     = check_cmd("mpv");
            let yt_dlp  = check_cmd("yt-dlp");
            let ffprobe = check_cmd("ffprobe");
            let msg = format!(
                "Installation complete.\nmpv: {}  yt-dlp: {}  ffprobe: {}\n{}",
                if mpv     { "✓" } else { "✗ (install manually)" },
                if yt_dlp  { "✓" } else { "✗ (run: pip3 install yt-dlp)" },
                if ffprobe { "✓" } else { "✗ (part of ffmpeg)" },
                if !installed { "No supported package manager found." } else { "" }
            );
            Ok(InstallResult { success: mpv || yt_dlp, message: msg })
        }

        #[cfg(target_os = "windows")]
        {
            let mut log = String::new();
            let mut success = false;

            // shinchiro.mpv = official mpv Windows builds.
            // mpv.net is a separate .NET wrapper app — does NOT provide the mpv binary.
            let winget_ok = Command::new("winget")
                .args(["install", "--id", "shinchiro.mpv", "-e",
                       "--accept-source-agreements", "--accept-package-agreements"])
                .output().map(|o| o.status.success()).unwrap_or(false);

            if winget_ok {
                let _ = Command::new("winget")
                    .args(["install", "--id", "Gyan.FFmpeg", "-e",
                           "--accept-source-agreements", "--accept-package-agreements"])
                    .output();
                success = true;
                log.push_str("Installed via winget.\n");
            } else {
                let choco_ok = Command::new("choco")
                    .args(["install", "mpv", "ffmpeg", "-y"])
                    .output().map(|o| o.status.success()).unwrap_or(false);
                if choco_ok {
                    success = true;
                    log.push_str("Installed via chocolatey.\n");
                } else {
                    log.push_str("winget and chocolatey not found.\nPlease install manually:\n\
                        - mpv: https://mpv.io/installation/\n\
                        - yt-dlp: https://github.com/yt-dlp/yt-dlp\n\
                        - ffmpeg: https://ffmpeg.org/download.html\n");
                }
            }

            // Try all yt-dlp install paths
            let _ = Command::new("winget")
                .args(["install", "--id", "yt-dlp.yt-dlp", "-e",
                       "--accept-source-agreements", "--accept-package-agreements"])
                .output();
            for pip in &["pip", "pip3"] {
                if Command::new(pip).args(["install", "--upgrade", "yt-dlp"])
                    .output().map(|o| o.status.success()).unwrap_or(false) { break; }
            }
            let _ = Command::new("python").args(["-m", "pip", "install", "--upgrade", "yt-dlp"]).output();

            let mpv     = Command::new("mpv").arg("--version").output().map(|o| o.status.success()).unwrap_or(false);
            let yt_dlp  = Command::new("yt-dlp").arg("--version").output().map(|o| o.status.success()).unwrap_or(false);
            let ffprobe = Command::new("ffprobe").arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
            let msg = format!(
                "{}\nmpv: {}  yt-dlp: {}  ffprobe: {}",
                log,
                if mpv     { "✓" } else { "✗ (restart may be needed)" },
                if yt_dlp  { "✓" } else { "✗ (restart may be needed)" },
                if ffprobe { "✓" } else { "✗" },
            );
            Ok(InstallResult { success, message: msg })
        }

        #[cfg(target_os = "macos")]
        {
            let mut log = String::new();
            let mut success = false;

            // Check if Homebrew is installed
            // Try common Homebrew paths (Apple Silicon and Intel Macs)
            let brew_path = if std::path::Path::new("/opt/homebrew/bin/brew").exists() {
                "/opt/homebrew/bin/brew" // Apple Silicon
            } else if std::path::Path::new("/usr/local/bin/brew").exists() {
                "/usr/local/bin/brew" // Intel Mac
            } else {
                // Fallback to PATH search
                if Command::new("which")
                    .arg("brew")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                {
                    "brew"
                } else {
                    log.push_str("Homebrew not found. Install from https://brew.sh\n");
                    return Ok(InstallResult {
                        success: false,
                        message: log,
                    });
                }
            };

            log.push_str(&format!("Using Homebrew ({}) to install dependencies...\n", brew_path));

            // Install mpv
            let mpv_result = Command::new(brew_path)
                .args(["install", "mpv"])
                .output();
            match mpv_result {
                Ok(out) => {
                    log.push_str(&String::from_utf8_lossy(&out.stdout));
                    if out.status.success() {
                        log.push_str("✓ mpv installed\n");
                        success = true;
                    } else {
                        log.push_str("✗ mpv installation failed\n");
                    }
                }
                Err(e) => log.push_str(&format!("Error installing mpv: {}\n", e)),
            }

            // Install ffmpeg
            let ffmpeg_result = Command::new(brew_path)
                .args(["install", "ffmpeg"])
                .output();
            match ffmpeg_result {
                Ok(out) => {
                    log.push_str(&String::from_utf8_lossy(&out.stdout));
                    if out.status.success() {
                        log.push_str("✓ ffmpeg installed\n");
                    } else {
                        log.push_str("✗ ffmpeg installation failed\n");
                    }
                }
                Err(e) => log.push_str(&format!("Error installing ffmpeg: {}\n", e)),
            }

            // Install yt-dlp via pip
            log.push_str("Installing yt-dlp via pip...\n");
            for pip in &["pip3", "pip"] {
                if let Ok(out) = Command::new(pip).args(["install", "--upgrade", "--user", "yt-dlp"]).output() {
                    log.push_str(&String::from_utf8_lossy(&out.stdout));
                    if out.status.success() {
                        log.push_str("✓ yt-dlp installed\n");
                        break;
                    }
                }
            }

            // Verify installations with full paths if needed
            let check_cmd = |cmd: &str| -> bool {
                // First try direct command
                if let Ok(out) = Command::new(cmd).arg("--version").output() {
                    if out.status.success() {
                        return true;
                    }
                } 
                if let Ok(out) = Command::new(cmd).arg("-version").output() {
                    if out.status.success() {
                        return true;
                    }
                }
                
                // Try with Homebrew paths for Apple Silicon and Intel
                for base_path in &["/opt/homebrew/bin", "/usr/local/bin"] {
                    let full_path = format!("{}/{}", base_path, cmd);
                    if let Ok(out) = Command::new(&full_path).arg("--version").output() {
                        if out.status.success() {
                            return true;
                        }
                    }
                    if let Ok(out) = Command::new(&full_path).arg("-version").output() {
                        if out.status.success() {
                            return true;
                        }
                    }
                }
                
                false
            };

            let mpv     = check_cmd("mpv");
            let yt_dlp  = check_cmd("yt-dlp");
            let ffprobe = check_cmd("ffprobe");

            log.push_str(&format!("\n─── Installation Status ───\n"));
            log.push_str(&format!("mpv: {}  yt-dlp: {}  ffprobe: {}\n",
                if mpv     { "✓" } else { "✗" },
                if yt_dlp  { "✓" } else { "✗" },
                if ffprobe { "✓" } else { "✗" }
            ));

            Ok(InstallResult { success: success || mpv || yt_dlp, message: log })
        }

        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        { Ok(InstallResult { success: false, message: "Unsupported platform".to_string() }) }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tauri::command]
fn ping() -> String { "pong".to_string() }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            check_dependencies,
            install_dependencies,
            get_yt_dlp_version,
            update_yt_dlp,
            search_youtube,
            prefetch_track,
            import_csv_playlist,
            import_youtube_playlist,
            open_url_in_browser,
            set_loudnorm_enabled,
            get_loudnorm_enabled,
            set_cache_dir,
            get_cache_dir,
            get_cache_size,
            clear_cache,
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
            get_audio_info,
            set_equalizer,
            set_sleep_timer,
            cancel_sleep_timer,
            get_sleep_timer_remaining,
            download_song,
            batch_download,
            scan_downloads,
            delete_local_file,
            rename_local_file,
            open_in_file_manager,
            get_audio_metadata,
            get_waveform_thumbnail,
            get_disk_usage,
            export_playlist_m3u,
            import_playlist_m3u,
            normalize_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                kill_mpv();
                #[cfg(unix)]
                { let _ = std::fs::remove_file(SOCKET_PATH); }
            }
        });
}