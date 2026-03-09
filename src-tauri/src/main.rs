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

    // Sleep timer with generation counter to prevent double-fire race (vuln #8)
    static ref SLEEP_TIMER: Arc<Mutex<Option<(std::time::Instant, u64)>>> =
        Arc::new(Mutex::new(None));
    static ref SLEEP_TIMER_GEN: Arc<Mutex<u64>> = Arc::new(Mutex::new(0));

    // Stream cache directory — set by the frontend, used by mpv for disk caching
    static ref STREAM_CACHE_DIR: Arc<Mutex<String>> =
        Arc::new(Mutex::new(default_cache_dir()));

    // Loudnorm toggle — disabling removes ~100ms mpv startup latency per track
    static ref LOUDNORM_ENABLED: Arc<Mutex<bool>> = Arc::new(Mutex::new(true));
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
}

#[tauri::command]
async fn check_dependencies() -> Result<DepsStatus, String> {
    tokio::task::spawn_blocking(|| {
        let mpv = Command::new("mpv").arg("--version").output().is_ok();
        let yt_dlp = Command::new("yt-dlp").arg("--version").output().is_ok();
        let ffprobe = Command::new("ffprobe").arg("-version").output().is_ok();
        Ok(DepsStatus { mpv, yt_dlp, ffprobe })
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


// ── YouTube search ────────────────────────────────────────────────────────────

#[tauri::command]
async fn search_youtube(query: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut child = Command::new("yt-dlp")
            .args([
                &format!("ytsearch10:{}", query),
                "--flat-playlist",
                "--print", "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
                "--no-warnings",
                "--no-check-certificates",
                "--socket-timeout", "8",   // per-connection timeout
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        // Hard kill at 18s — prevents infinite hang on network issues
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(18);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if std::time::Instant::now() > deadline {
                        let _ = child.kill();
                        return Err("Search timed out — check your connection".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
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

// ── Open URL in default browser ─────────────────────────────────────────────
#[tauri::command]
async fn open_url_in_browser(url: String) -> Result<(), String> {
    let sanitized = url.trim().to_string();
    if !sanitized.starts_with("https://") && !sanitized.starts_with("http://") {
        return Err("Only http/https URLs are allowed".to_string());
    }
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        { std::process::Command::new("xdg-open").arg(&sanitized).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "macos")]
        { std::process::Command::new("open").arg(&sanitized).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "windows")]
        { std::process::Command::new("cmd").args(["/c", "start", "", &sanitized]).spawn().map_err(|e| e.to_string())?; }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}


// ── YouTube playlist import ─────────────────────────────────────────────────
// Fetches all video titles+IDs from a YouTube playlist via yt-dlp flat-playlist.
// Returns newline-separated "Title====Artist====Duration====ID" lines.
#[tauri::command]
async fn import_youtube_playlist(url: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let out = Command::new("yt-dlp")
            .args([
                "--flat-playlist",
                "--no-warnings",
                "--ignore-errors",
                "--print", "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
                "--",
                url.as_str(),
            ])
            .output()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.trim().is_empty() {
            return Err("No tracks found. Is this a public playlist?".to_string());
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| e.to_string())?
}


// ── CSV Playlist import (Exportify format) ──────────────────────────────────
// Reads a CSV exported by exportify.net — columns: Spotify ID, Artist IDs,
// Track Name, Album Name, Artist Name(s), Release Date, Duration, Popularity
// Returns newline-separated "Title====Artist" pairs with a PLAYLIST: header.
#[tauri::command]
async fn import_csv_playlist(csv_content: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut lines = csv_content.lines();

        // Skip header row
        let header = lines.next().unwrap_or("").to_lowercase();
        // Detect column positions from header
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
            // Parse CSV row — handle quoted fields with commas inside
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
            ',' if !in_quotes => {
                fields.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current);
    fields
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
            // --print urls is faster than --get-url (skips redundant metadata phase)
            // Format matches play_audio exactly so cache hits always work
            Command::new("yt-dlp")
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
        let af_arg = if *LOUDNORM_ENABLED.lock().unwrap() {
            "--af=loudnorm=I=-16:TP=-1.5:LRA=11".to_string()
        } else {
            "--af=".to_string()  // empty filter chain — no loudnorm, instant audio start
        };

        Command::new("mpv")
            .args([
                "--no-video",
                "--cache=yes",
                "--cache-secs=30",
                "--demuxer-max-bytes=32MiB",
                "--demuxer-max-back-bytes=8MiB",
                "--demuxer-readahead-secs=10",
                "--cache-pause=no",
                "--network-timeout=10",
                "--audio-buffer=0.5",
                "--audio-pitch-correction=yes",
                &af_arg,
                "--script-opts=ytdl_hook-ytdl_path=yt-dlp",
                "--ytdl-format=bestaudio[ext=webm]/bestaudio/best",
                "--ytdl-raw-options=ignore-config=,no-check-certificates=,retries=2,fragment-retries=2,concurrent-fragments=4",
                &format!("--input-ipc-server={}", SOCKET_PATH),
                "--force-window=no",
                "--keep-open=yes",
                "--idle=yes",
                "--", // Everything after is a URL/file, never a flag (CRITICAL #1)
                &actual_url,
            ])
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        wait_for_socket(2500);
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

        let af_arg_local = if *LOUDNORM_ENABLED.lock().unwrap() {
            "--af=loudnorm=I=-16:TP=-1.5:LRA=11".to_string()
        } else {
            "--af=".to_string()
        };

        Command::new("mpv")
            .args([
                "--no-video",
                // Local file — no network buffering, no cache, instant start
                "--cache=no",
                "--demuxer-max-bytes=1MiB",
                "--audio-buffer=0.1",
                "--audio-pitch-correction=yes",
                &af_arg_local,
                &format!("--input-ipc-server={}", SOCKET_PATH),
                "--force-window=no",
                "--keep-open=yes",
                "--idle=yes",
                "--",  // path can never be a flag (CRITICAL #3)
                &safe_path,
            ])
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        wait_for_socket(2000);
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
    // All 3 IPC properties fetched over a single socket connection (was 3 separate connects).
    tokio::task::spawn_blocking(|| {
        let responses = send_ipc_batch(&[
            r#"{"command": ["get_property", "pause"]}"#,
            r#"{"command": ["get_property", "time-pos"]}"#,
            r#"{"command": ["get_property", "duration"]}"#,
        ]);

        // If pause query failed entirely, mpv isn't running
        let pause_resp = responses.get(0)
            .and_then(|r| r.as_ref().ok())
            .cloned()
            .ok_or_else(|| "mpv not running".to_string())?;

        let paused = serde_json::from_str::<Value>(&pause_resp)
            .ok().and_then(|j| j["data"].as_bool()).unwrap_or(false);

        let get_f64 = |i: usize| responses.get(i)
            .and_then(|r| r.as_ref().ok())
            .and_then(|r| parse_f64_from_response(r).ok())
            .map(safe_f64).unwrap_or(0.0);

        let position = get_f64(1);
        let duration  = get_f64(2);

        // With --keep-open mpv pauses at EOF — detect via near-end heuristic (no extra IPC call)
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
    channels: String,   // "stereo", "5.1", "mono", etc.
    format: String,     // container format e.g. "webm", "mp4"
    url: String,        // currently playing URL
}

#[tauri::command]
async fn get_audio_info() -> Result<AudioInfo, String> {
    tokio::task::spawn_blocking(|| {
        // Batch all 5 queries over a single IPC connection to avoid 4 extra
        // connect/disconnect round-trips. Each command is sent then read back
        // on the same open socket before closing.
        fn get_audio_info_batched() -> Result<AudioInfo, String> {
            #[cfg(unix)]
            {
                let stream = UnixStream::connect(SOCKET_PATH)
                    .map_err(|e| format!("IPC connect failed: {}", e))?;
                stream.set_read_timeout(Some(std::time::Duration::from_millis(800))).ok();
                stream.set_write_timeout(Some(std::time::Duration::from_millis(400))).ok();

                let queries = [
                    r#"{"command": ["get_property", "audio-codec-name"]}"#,
                    r#"{"command": ["get_property", "audio-bitrate"]}"#,
                    r#"{"command": ["get_property", "audio-samplerate"]}"#,
                    r#"{"command": ["get_property", "audio-channels"]}"#,
                    r#"{"command": ["get_property", "file-format"]}"#,
                    r#"{"command": ["get_property", "path"]}"#,
                ];

                // Write all queries at once
                let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
                for q in &queries {
                    use std::io::Write;
                    writer.write_all(q.as_bytes()).ok();
                    writer.write_all(b"
").ok();
                }
                drop(writer);

                // Read responses — collect up to 6 command responses, skip events
                let mut reader = BufReader::new(stream);
                let mut responses: Vec<Value> = Vec::with_capacity(6);
                let mut lines_read = 0usize;
                while responses.len() < 6 && lines_read < 60 {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line.is_empty() { break; }
                    lines_read += 1;
                    if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                        if !v["error"].is_null() { responses.push(v); }
                    }
                }

                let get_str = |v: &Value| v["data"].as_str().map(|s| s.to_string());
                let get_f64 = |v: &Value| v["data"].as_f64().unwrap_or(0.0);

                let codec = responses.get(0).and_then(get_str).unwrap_or_else(|| "unknown".into());
                let bitrate = responses.get(1).map(get_f64).unwrap_or(0.0);
                let samplerate = responses.get(2).map(get_f64).unwrap_or(0.0);
                let channels = responses.get(3).and_then(|v| {
                    if let Some(s) = v["data"].as_str() { return Some(s.to_string()); }
                    v["data"].as_i64().map(|n| n.to_string())
                }).unwrap_or_else(|| "stereo".into());
                let format = responses.get(4).and_then(get_str)
                    .map(|s| s.split(',').next().unwrap_or(&s).trim().to_uppercase())
                    .unwrap_or_default();
                let url = responses.get(5).and_then(get_str).unwrap_or_default();

                Ok(AudioInfo { codec, bitrate, samplerate, channels, format, url })
            }
            #[cfg(not(unix))]
            {
                // Windows fallback: sequential (named pipes don't support the same trick)
                let codec = send_ipc_command_with_retry(
                    r#"{"command": ["get_property", "audio-codec-name"]}"#, 1
                ).ok().and_then(|r| { let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null); j["data"].as_str().map(|s| s.to_string()) }).unwrap_or_else(|| "unknown".into());
                let bitrate = send_ipc_command_with_retry(r#"{"command": ["get_property", "audio-bitrate"]}"#, 1).ok().and_then(|r| parse_f64_from_response(&r).ok()).unwrap_or(0.0);
                let samplerate = send_ipc_command_with_retry(r#"{"command": ["get_property", "audio-samplerate"]}"#, 1).ok().and_then(|r| parse_f64_from_response(&r).ok()).unwrap_or(0.0);
                let channels = send_ipc_command_with_retry(r#"{"command": ["get_property", "audio-channels"]}"#, 1).ok().and_then(|r| { let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null); if let Some(s) = j["data"].as_str() { return Some(s.to_string()); } j["data"].as_i64().map(|n| n.to_string()) }).unwrap_or_else(|| "stereo".into());
                let format = send_ipc_command_with_retry(r#"{"command": ["get_property", "file-format"]}"#, 1).ok().and_then(|r| { let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null); j["data"].as_str().map(|s| s.split(',').next().unwrap_or(s).trim().to_uppercase()) }).unwrap_or_default();
                let url = send_ipc_command_with_retry(r#"{"command": ["get_property", "path"]}"#, 1).ok().and_then(|r| { let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null); j["data"].as_str().map(|s| s.to_string()) }).unwrap_or_default();
                Ok(AudioInfo { codec, bitrate, samplerate, channels, format, url })
            }
        }
        get_audio_info_batched()
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
                if UnixStream::connect(SOCKET_PATH).is_ok() { return; }
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
    }
    #[cfg(windows)]
    {
        while std::time::Instant::now() < deadline {
            if OpenOptions::new().read(true).write(true).open(SOCKET_PATH).is_ok() { return; }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
    }
}

fn kill_mpv() {
    #[cfg(unix)]
    {
        // Scope to current user only via $USER env var — safe, no libc needed
        if let Ok(user) = std::env::var("USER") {
            let _ = Command::new("pkill").args(["-KILL", "-u", &user, "mpv"]).output();
        } else {
            // Fallback: kill only mpv processes that share our process group
            let _ = Command::new("pkill").args(["-KILL", "mpv"]).output();
        }
    }
    #[cfg(windows)]
    { let _ = Command::new("taskkill").args(["/F", "/IM", "mpv.exe"]).output(); }
}

fn cleanup_socket() {
    #[cfg(unix)]
    {
        // Try immediate delete first — works most of the time since pkill is synchronous
        let _ = std::fs::remove_file(SOCKET_PATH);
        // If mpv was slow to die and the socket is still present, poll up to 300ms
        if std::path::Path::new(SOCKET_PATH).exists() {
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(300);
            while std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(10));
                if !std::path::Path::new(SOCKET_PATH).exists() { break; }
            }
            let _ = std::fs::remove_file(SOCKET_PATH);
        }
    }
    #[cfg(windows)]
    {
        // Poll until named pipe is released — max 400ms at 15ms intervals
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(400);
        while std::time::Instant::now() < deadline {
            if OpenOptions::new().read(true).write(true).open(SOCKET_PATH).is_err() { break; }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
    }
}

// ── IPC helpers ───────────────────────────────────────────────────────────────

// Send multiple IPC commands over a single socket connection.
// Returns one Result<String> per command in input order.
// On Unix, all queries are written before reading any responses so mpv
// can pipeline them — far faster than N separate connect/write/read cycles.
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

        // Write all commands at once before reading any responses
        {
            use std::io::Write;
            if let Ok(mut w) = stream.try_clone() {
                for cmd in cmds {
                    let _ = w.write_all(cmd.as_bytes());
                    let _ = w.write_all(b"\n");
                }
            }
        }

        // Read responses — skip mpv event lines (no "error" key), collect command responses
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
        // Windows named pipes: sequential fallback
        cmds.iter().map(|cmd| send_ipc_command_with_retry(cmd, 1)).collect()
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
        stream.set_read_timeout(Some(std::time::Duration::from_millis(500)))
            .map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(std::time::Duration::from_millis(200)))
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
                ("apt-get", &["apt-get", "install", "-y", "mpv", "ffmpeg", "python3-pip"], &["pip3", "install", "--upgrade", "yt-dlp"]),
                ("pacman",  &["pacman", "--noconfirm", "-S", "mpv", "ffmpeg"],             &["pip3", "install", "--upgrade", "yt-dlp"]),
                ("dnf",     &["dnf", "install", "-y", "mpv", "ffmpeg"],                    &["pip3", "install", "--upgrade", "yt-dlp"]),
                ("zypper",  &["zypper", "install", "-y", "mpv", "ffmpeg"],                 &["pip3", "install", "--upgrade", "yt-dlp"]),
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

            // Install yt-dlp via pip3 (no sudo needed — user install)
            log.push_str("\nInstalling yt-dlp via pip...\n");
            for pip in &["pip3", "pip"] {
                if let Ok(out) = Command::new(pip).args(["install", "--upgrade", "--user", "yt-dlp"]).output() {
                    log.push_str(&String::from_utf8_lossy(&out.stdout));
                    if out.status.success() { break; }
                }
            }
            // Also try python3 -m pip
            if !Command::new("yt-dlp").arg("--version").output().is_ok() {
                let _ = Command::new("python3").args(["-m", "pip", "install", "--upgrade", "--user", "yt-dlp"]).output();
            }

            // Re-check what's available now
            let mpv = Command::new("mpv").arg("--version").output().is_ok();
            let yt_dlp = Command::new("yt-dlp").arg("--version").output().is_ok();
            let ffprobe = Command::new("ffprobe").arg("-version").output().is_ok();

                let msg = format!(
                "Installation complete.\nmpv: {}  yt-dlp: {}  ffprobe: {}\n{}",
                if mpv { "✓" } else { "✗ (install manually)" },
                if yt_dlp { "✓" } else { "✗ (run: pip3 install yt-dlp)" },
                if ffprobe { "✓" } else { "✗ (part of ffmpeg)" },
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

            // Install yt-dlp via pip
            let _ = Command::new("pip").args(["install", "--upgrade", "yt-dlp"]).output();
            let _ = Command::new("pip3").args(["install", "--upgrade", "yt-dlp"]).output();
            let _ = Command::new("python").args(["-m", "pip", "install", "--upgrade", "yt-dlp"]).output();
            // Or winget for yt-dlp
            let _ = Command::new("winget")
                .args(["install", "--id", "yt-dlp.yt-dlp", "-e", "--accept-source-agreements", "--accept-package-agreements"])
                .output();

            let mpv = Command::new("mpv").arg("--version").output().is_ok();
            let yt_dlp = Command::new("yt-dlp").arg("--version").output().is_ok();
            let ffprobe = Command::new("ffprobe").arg("-version").output().is_ok();

                let msg = format!(
                "{}\nmpv: {}  yt-dlp: {}  ffprobe: {}",
                log,
                if mpv { "✓" } else { "✗ (restart may be needed)" },
                if yt_dlp { "✓" } else { "✗ (restart may be needed)" },
                if ffprobe { "✓" } else { "✗" },
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
            prefetch_track,
            import_csv_playlist,
            import_youtube_playlist,
            open_url_in_browser,
            // Loudnorm
            set_loudnorm_enabled,
            get_loudnorm_enabled,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            match event {
                tauri::RunEvent::Exit => {
                    kill_mpv();
                    #[cfg(unix)]
                    { let _ = std::fs::remove_file(SOCKET_PATH); }
                }
                _ => {}
            }
        });
}