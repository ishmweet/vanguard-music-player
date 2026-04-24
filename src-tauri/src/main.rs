mod tray;
mod audio_device;

use std::io::{Write, BufRead, BufReader};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use serde_json::Value;
use tauri::Emitter;
use tauri::Manager;

// On Windows, every spawned process gets a visible CMD flash unless we set
// CREATE_NO_WINDOW. This trait applies it automatically on Windows and is a
// no-op on Linux/macOS, so all call sites stay identical.
#[cfg(windows)]
use std::os::windows::process::CommandExt;

trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for Command {
    #[cfg(windows)]
    fn no_window(&mut self) -> &mut Self {
        self.creation_flags(0x08000000)
    }
    #[cfg(not(windows))]
    fn no_window(&mut self) -> &mut Self {
        self
    }
}

#[cfg(unix)]
use std::os::unix::net::UnixStream;

#[cfg(windows)]
use std::fs::OpenOptions;

#[cfg(unix)]
const SOCKET_PATH: &str = "/tmp/mpvsocket";

#[cfg(windows)]
const SOCKET_PATH: &str = r"\\.\pipe\mpvsocket";

#[derive(Clone, Default)]
struct MprisMetadata {
    title: String,
    artist: String,
    cover_url: String,
    duration_us: i64,
    playing: bool,
}

static MPRIS_META: std::sync::OnceLock<Mutex<MprisMetadata>> = std::sync::OnceLock::new();

fn mpris_meta() -> &'static Mutex<MprisMetadata> {
    MPRIS_META.get_or_init(|| Mutex::new(MprisMetadata::default()))
}

#[cfg(target_os = "linux")]
static MPRIS_TX: std::sync::OnceLock<tokio::sync::watch::Sender<()>> = std::sync::OnceLock::new();

#[cfg(target_os = "linux")]
fn mpris_notify() {
    if let Some(tx) = MPRIS_TX.get() { let _ = tx.send(()); }
}
#[cfg(not(target_os = "linux"))]
fn mpris_notify() {}

fn resolve_bin(name: &str, search_paths: &[String]) -> String {
    for dir in search_paths {
        #[cfg(target_os = "windows")]
        let full = format!("{}\\{}.exe", dir, name);
        #[cfg(not(target_os = "windows"))]
        let full = format!("{}/{}", dir, name);

        let p = std::path::Path::new(&full);
        if p.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = p.metadata() {
                    if meta.permissions().mode() & 0o111 != 0 {
                        return full;
                    }
                }
            }
            #[cfg(windows)]
            return full;
        }
    }
    name.to_string()
}

static BIN_MPV:     std::sync::OnceLock<String> = std::sync::OnceLock::new();
static BIN_YTDLP:   std::sync::OnceLock<String> = std::sync::OnceLock::new();
static BIN_FFPROBE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
static BIN_FFMPEG:  std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn init_bin_paths() {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut paths: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let user_profile   = std::env::var("USERPROFILE").unwrap_or_default();
        
        paths.push(format!("{}\\Programs\\vanguard-deps\\mpv",    local_app_data));
        paths.push(format!("{}\\Programs\\vanguard-deps\\ffmpeg",  local_app_data));
        paths.push(format!("{}\\Programs\\vanguard-deps",          local_app_data));
        
        paths.push(format!("{}\\Programs\\mpv",    local_app_data));
        paths.push("C:\\Program Files\\mpv".into());
        paths.push("C:\\Program Files (x86)\\mpv".into());
        paths.push("C:\\ProgramData\\chocolatey\\bin".into());
        paths.push(format!("{}\\scoop\\shims", user_profile));
        paths.push(format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", user_profile));
    }

    #[cfg(not(target_os = "windows"))]
    {
        
        let appimage = std::env::var("APPIMAGE").is_ok();
        let host = if appimage { "/proc/1/root" } else { "" };

        for p in &[
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            "/snap/bin".to_string(),
            "/var/lib/flatpak/exports/bin".to_string(),
            "/usr/games".to_string(),
        ] {
            if !host.is_empty() { paths.push(format!("{}{}", host, p)); }
            paths.push(p.clone());
        }
    }

    
    if let Ok(env_path) = std::env::var("PATH") {
        #[cfg(target_os = "windows")]
        let sep = ';';
        #[cfg(not(target_os = "windows"))]
        let sep = ':';
        for p in env_path.split(sep) {
            let s = p.to_string();
            if !paths.contains(&s) { paths.push(s); }
        }
    }

    
    #[cfg(target_os = "windows")]
    let sep = ";";
    #[cfg(not(target_os = "windows"))]
    let sep = ":";

    let clean: Vec<&str> = paths.iter()
        .filter(|p| !p.starts_with("/proc/1/root"))
        .map(|s| s.as_str())
        .collect();
    std::env::set_var("PATH", clean.join(sep));

    let mpv     = resolve_bin("mpv",     &paths);
    let ytdlp   = resolve_bin("yt-dlp",  &paths);
    let ffprobe = resolve_bin("ffprobe", &paths);
    let ffmpeg  = resolve_bin("ffmpeg",  &paths);

    eprintln!("[vanguard] mpv     -> {}", mpv);
    eprintln!("[vanguard] yt-dlp  -> {}", ytdlp);
    eprintln!("[vanguard] ffprobe -> {}", ffprobe);
    eprintln!("[vanguard] ffmpeg  -> {}", ffmpeg);

    
    
    fn set_or_update(lock: &std::sync::OnceLock<String>, val: String) {
        if lock.get().is_none() {
            let _ = lock.set(val);
        }
        
    }
    set_or_update(&BIN_MPV,     mpv);
    set_or_update(&BIN_YTDLP,   ytdlp);
    set_or_update(&BIN_FFPROBE, ffprobe);
    set_or_update(&BIN_FFMPEG,  ffmpeg);
}

fn bin_mpv()     -> &'static str { BIN_MPV.get().map(|s| s.as_str()).unwrap_or("mpv") }
fn bin_ytdlp()   -> &'static str { BIN_YTDLP.get().map(|s| s.as_str()).unwrap_or("yt-dlp") }
fn bin_ffprobe() -> &'static str { BIN_FFPROBE.get().map(|s| s.as_str()).unwrap_or("ffprobe") }
fn bin_ffmpeg()  -> &'static str { BIN_FFMPEG.get().map(|s| s.as_str()).unwrap_or("ffmpeg") }

struct CacheEntry { url: String, ts: std::time::Instant }

lazy_static::lazy_static! {
    static ref PREFETCH_CACHE: Arc<Mutex<HashMap<String, CacheEntry>>> =
        Arc::new(Mutex::new(HashMap::new()));

    static ref SLEEP_TIMER: Arc<Mutex<Option<(std::time::Instant, u64)>>> =
        Arc::new(Mutex::new(None));
    static ref SLEEP_TIMER_GEN: Arc<Mutex<u64>> = Arc::new(Mutex::new(0));

    static ref LOUDNORM_ENABLED: Arc<Mutex<bool>> = Arc::new(Mutex::new(true));
    static ref SKIP_SILENCE: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
    static ref STREAM_QUALITY: Arc<Mutex<String>> = Arc::new(Mutex::new("best".to_string()));
}

// Persistent mpv process handle — spawned once at startup, reused across all tracks.
// Using Option<Child> so we can detect crashes and respawn.
static MPV_PROCESS: std::sync::OnceLock<Mutex<Option<std::process::Child>>> = std::sync::OnceLock::new();
fn mpv_process() -> &'static Mutex<Option<std::process::Child>> {
    MPV_PROCESS.get_or_init(|| Mutex::new(None))
}

// Monotonic play request counter — incremented on every play_audio call.
// Each spawned extraction task captures its counter value; if it no longer
// matches the global when done, the result is stale and discarded.
static PLAY_COUNTER: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

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


fn safe_f64(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

#[tauri::command]
async fn search_youtube(query: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut child = Command::new(bin_ytdlp())
            .args([
                &format!("ytsearch40:{}", query),
                "--flat-playlist",
                "--print", "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
                "--no-warnings",
                "--no-check-certificates",
                "--socket-timeout", "8",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .no_window()
            .spawn()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        
        
        
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

#[tauri::command]
async fn open_url_in_browser(url: String) -> Result<(), String> {
    let sanitized = url.trim().to_string();
    if !sanitized.starts_with("https://") && !sanitized.starts_with("http://") {
        return Err("Only http/https URLs are allowed".to_string());
    }
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        { Command::new("xdg-open").arg(&sanitized).no_window().spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "macos")]
        { Command::new("open").arg(&sanitized).no_window().spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "windows")]
        { Command::new("cmd").args(["/c", "start", "", &sanitized]).no_window().spawn().map_err(|e| e.to_string())?; }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_youtube_playlist(url: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut child = Command::new(bin_ytdlp())
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
            .no_window()
            .spawn()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        
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

#[tauri::command]
async fn prefetch_track(url: String) -> Result<(), String> {
    if url.starts_with("local://") { return Ok(()); }
    if PREFETCH_CACHE.lock().unwrap().contains_key(&url) { return Ok(()); }
    let cache = Arc::clone(&PREFETCH_CACHE);
    tokio::spawn(async move {
        let url_clone = url.clone();
        let result = tokio::task::spawn_blocking(move || {
            extract_stream_url(&url_clone)
        })
        .await;
        if let Ok(Some(stream_url)) = result {
            let mut c = cache.lock().unwrap();
            let now = std::time::Instant::now();
            c.retain(|_, v| now.duration_since(v.ts) < std::time::Duration::from_secs(3600));
            if c.len() >= 50 { c.clear(); }
            c.insert(url, CacheEntry { url: stream_url, ts: now });
        }
    });
    Ok(())
}

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
fn set_skip_silence(enabled: bool) -> Result<(), String> {
    *SKIP_SILENCE.lock().unwrap() = enabled;
    // Apply to the running mpv instance immediately via IPC.
    // silenceremove=1:0:-50dB removes leading silence and gaps between sections.
    let af_cmd = if enabled {
        r#"{"command": ["set_property", "af", "silenceremove=1:0:-50dB"]}"#.to_string()
    } else {
        r#"{"command": ["set_property", "af", ""]}"#.to_string()
    };
    let _ = send_ipc_command(&af_cmd);
    Ok(())
}

#[tauri::command]
fn set_stream_quality(quality: String) -> Result<(), String> {
    *STREAM_QUALITY.lock().unwrap() = quality;
    Ok(())
}

fn mpv_af_flag() -> Option<String> {
    let loudnorm = *LOUDNORM_ENABLED.lock().unwrap();
    let skip_silence = *SKIP_SILENCE.lock().unwrap();
    match (loudnorm, skip_silence) {
        (true,  true)  => Some("--af=loudnorm=I=-16:TP=-1.5:LRA=11,silenceremove=1:0:-50dB".to_string()),
        (true,  false) => Some("--af=loudnorm=I=-16:TP=-1.5:LRA=11".to_string()),
        (false, true)  => Some("--af=silenceremove=1:0:-50dB".to_string()),
        (false, false) => None,
    }
}

// ── Persistent mpv management ────────────────────────────────────────────────

/// Spawn mpv in idle mode if not already running, or if the stored process died.
/// Returns true if mpv is ready (socket connectable).
fn ensure_mpv_running() -> bool {
    let mut guard = mpv_process().lock().unwrap();

    // Check if existing process is still alive
    let alive = guard.as_mut().map(|c| c.try_wait().ok() == Some(None)).unwrap_or(false);
    if alive && wait_for_socket(200) { return true; }

    // Either dead or never started — (re)spawn
    *guard = None;
    let _ = std::fs::remove_file(SOCKET_PATH); // clean stale socket

    let mut args: Vec<String> = vec![
        "--no-video".into(),
        "--idle=yes".into(),
        "--keep-open=yes".into(),
        "--cache=yes".into(),
        "--cache-secs=10".into(),
        "--demuxer-max-bytes=10MiB".into(),
        "--demuxer-max-back-bytes=2MiB".into(),
        "--demuxer-readahead-secs=2".into(),
        "--cache-pause=no".into(),
        "--network-timeout=15".into(),
        "--audio-buffer=0.2".into(),
        "--audio-pitch-correction=yes".into(),
        "--force-window=no".into(),
        format!("--input-ipc-server={}", SOCKET_PATH),
    ];
    if let Some(af) = mpv_af_flag() { args.push(af); }

    match Command::new(bin_mpv()).args(&args).no_window().spawn() {
        Ok(child) => { *guard = Some(child); }
        Err(_) => return false,
    }
    drop(guard); // release lock before waiting
    wait_for_socket(4000)
}

/// Switch to a new URL using IPC — NO process restart.
/// Sequence: set pause=yes → playlist-clear → loadfile replace
/// We do NOT send "stop" — stop makes mpv close the IPC socket briefly,
/// causing "broken pipe" on the next command. Instead we pause first,
/// clear the playlist, then loadfile replace which atomically replaces
/// whatever is playing. mpv handles this cleanly without socket disruption.
fn switch_track_ipc(url: &str) -> Result<(), String> {
    // Pause current playback first to avoid audio glitch
    let _ = send_ipc_command_with_retry(r#"{"command": ["set_property", "pause", true]}"#, 2);
    // Clear playlist
    send_ipc_command_with_retry(r#"{"command": ["playlist-clear"]}"#, 3)
        .map_err(|e| format!("playlist-clear failed: {}", e))?;
    // Small buffer to let mpv settle
    std::thread::sleep(std::time::Duration::from_millis(50));
    // loadfile replace: atomically replaces current entry and starts playing
    let cmd = serde_json::json!({"command": ["loadfile", url, "replace"]}).to_string();
    send_ipc_command_with_retry(&cmd, 3)
        .map_err(|e| format!("loadfile failed: {}", e))?;
    Ok(())
}

/// Fast URL extraction using yt-dlp -g (URL-only, no metadata parsing).
/// Tries multiple YouTube player clients and browser cookie sources in parallel.
/// First valid https CDN URL wins; remaining threads abort via cancel flag.
fn extract_stream_url(youtube_url: &str) -> Option<String> {
    use std::sync::{Arc, Mutex};
    use std::sync::atomic::{AtomicBool, Ordering};

    let found: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let cancel: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

    let fast_extract = |browser: Option<&str>, client: &str| -> Option<String> {
        let mut cmd = Command::new(bin_ytdlp());
        cmd.args([
            "--no-warnings", "--no-playlist", "--no-check-certificates",
            "--socket-timeout", "8", "--retries", "0",
            "-g",
            "--extractor-args", &format!("youtube:player_client={}", client),
        ]);
        if let Some(b) = browser { cmd.args(["--cookies-from-browser", b]); }
        cmd.args(["--", youtube_url]);
        let o = cmd.no_window().output().ok()?;
        if !o.status.success() { return None; }
        // -g returns one URL per line when there are multiple formats;
        // pick the first https non-manifest URL
        String::from_utf8_lossy(&o.stdout)
            .lines()
            .find(|l| l.starts_with("http") && !l.contains(".m3u8") && !l.contains("manifest.googlevideo.com"))
            .map(|s| s.trim().to_string())
    };

    // Ordered by reliability: web first (most compatible), then ios, then with cookies.
    // Each attempt is (browser_cookies, player_client).
    let attempts: &[(Option<&str>, &str)] = &[
        (None,              "web"),      // standard, usually works
        (None,              "ios"),      // fast CDN URLs, sometimes bot-flagged
        (None,              "android"),  // another fallback
        (Some("chrome"),    "web"),
        (Some("firefox"),   "web"),
        (Some("brave"),     "ios"),
        (Some("chromium"),  "ios"),
        (Some("edge"),      "web"),
    ];

    std::thread::scope(|s| {
        let found = &found;
        let cancel = &cancel;
        let fast_extract = &fast_extract;
        for &(browser, client) in attempts {
            s.spawn(move || {
                // Exit immediately if another thread already found a URL
                if cancel.load(Ordering::Relaxed) { return; }
                if let Some(url) = fast_extract(browser, client) {
                    let mut r = found.lock().unwrap();
                    if r.is_none() {
                        *r = Some(url);
                        cancel.store(true, Ordering::Relaxed); // signal other threads to stop
                    }
                }
            });
        }
    });

    Arc::try_unwrap(found).ok()
        .and_then(|m| m.into_inner().ok())
        .flatten()
}

#[tauri::command]
async fn play_audio(url: String) -> Result<(), String> {
    if url.starts_with("local://") {
        return play_local_file(url.trim_start_matches("local://").to_string()).await;
    }
    let safe_url = sanitize_stream_url(&url)?;

    // Increment counter — this is our play request ID.
    // Any extraction task that started before this call is now stale.
    let my_id = PLAY_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;

    tokio::task::spawn_blocking(move || {
        // ── Step 1: Cache lookup ─────────────────────────────────────────────
        let cached = {
            let mut cache = PREFETCH_CACHE.lock().unwrap();
            cache.remove(&safe_url).and_then(|entry| {
                let age = std::time::Instant::now().duration_since(entry.ts);
                if age < std::time::Duration::from_secs(3600)
                    && entry.url.starts_with("http")
                    && !entry.url.contains(".m3u8")
                    && !entry.url.contains("manifest.googlevideo.com")
                { Some(entry.url) } else { None }
            })
        };

        // ── Step 2: Race check ───────────────────────────────────────────────
        // If user already requested a different track, bail out immediately.
        if PLAY_COUNTER.load(std::sync::atomic::Ordering::SeqCst) != my_id {
            return Err("Superseded by newer play request".to_string());
        }

        // ── Step 3: Extract URL (fast -g path, parallel browsers) ────────────
        let stream_url = if let Some(c) = cached {
            c
        } else {
            let url = extract_stream_url(&safe_url)
                .ok_or_else(|| "Could not extract stream URL. Update yt-dlp: yt-dlp -U".to_string())?;

            // Race check again after extraction (may have taken 2-5s)
            if PLAY_COUNTER.load(std::sync::atomic::Ordering::SeqCst) != my_id {
                return Err("Superseded by newer play request".to_string());
            }
            url
        };

        // ── Step 4: Ensure mpv is running (spawn once, reuse forever) ────────
        if !ensure_mpv_running() {
            return Err("mpv failed to start or is not installed".to_string());
        }

        // Switch track via IPC — no process restart.
        switch_track_ipc(&stream_url).map_err(|e| format!("IPC switch failed: {}", e))?;
        // Explicitly unpause — switch_track_ipc pauses first, ensure we resume
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = send_ipc_command_with_retry(r#"{"command": ["set_property", "pause", false]}"#, 3);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn play_local_file(path: String) -> Result<(), String> {
    let safe_path = sanitize_file_path(&path)?.to_string_lossy().to_string();
    let my_id = PLAY_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;

    tokio::task::spawn_blocking(move || {
        if PLAY_COUNTER.load(std::sync::atomic::Ordering::SeqCst) != my_id {
            return Err("Superseded".to_string());
        }
        if !ensure_mpv_running() {
            return Err("mpv failed to start".to_string());
        }
        switch_track_ipc(&safe_path).map_err(|e| format!("IPC switch failed: {}", e))?;
        // Explicitly unpause so local files never start in paused state
        std::thread::sleep(std::time::Duration::from_millis(80));
        let _ = send_ipc_command_with_retry(r#"{"command": ["set_property", "pause", false]}"#, 3);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
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
    
    
    
    
    
    
    tokio::task::spawn_blocking(|| {
        let queries: &[&str] = &[
            r#"{"command": ["get_property", "audio-codec-name"]}"#,
            r#"{"command": ["get_property", "audio-bitrate"]}"#,
            r#"{"command": ["get_property", "audio-samplerate"]}"#,
            r#"{"command": ["get_property", "audio-channels"]}"#,
            r#"{"command": ["get_property", "file-format"]}"#,
            r#"{"command": ["get_property", "path"]}"#,
        ];
        
        let responses = send_ipc_batch(queries);

        
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

#[tauri::command]
async fn set_equalizer(bass: f64, mid: f64, treble: f64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let b = bass.clamp(-12.0, 12.0);
        let m = mid.clamp(-12.0, 12.0);
        let t = treble.clamp(-12.0, 12.0);
        let loudnorm_on = *LOUDNORM_ENABLED.lock().unwrap();
        let skip_sil    = *SKIP_SILENCE.lock().unwrap();
        let eq_active   = !(b == 0.0 && m == 0.0 && t == 0.0);

        // Build af chain. mpv's built-in `equalizer` filter uses the correct
        // parametric syntax: f=frequency:width_type=o:width=2:g=gain
        // Bass:   60 Hz shelf, Mid: 1000 Hz peak, Treble: 10000 Hz shelf
        let eq_chain = if eq_active {
            format!(
                "lavfi=[equalizer=f=60:width_type=o:width=2:g={b},equalizer=f=1000:width_type=o:width=2:g={m},equalizer=f=10000:width_type=o:width=2:g={t}]",
                b = b, m = m, t = t
            )
        } else {
            String::new()
        };

        let mut parts: Vec<&str> = Vec::new();
        let loudnorm = "loudnorm=I=-16:TP=-1.5:LRA=11";
        let silence  = "silenceremove=1:0:-50dB";
        let ln_owned;
        if loudnorm_on { parts.push(loudnorm); }
        if skip_sil    { parts.push(silence); }
        if eq_active   { ln_owned = eq_chain.clone(); parts.push(&ln_owned); }

        if parts.is_empty() {
            // All filters off — clear af entirely
            let cmd = r#"{"command": ["set_property", "af", ""]}"#;
            return send_ipc_command_with_retry(cmd, 2).map(|_| ());
        }

        let af_value = parts.join(",");
        let cmd = serde_json::json!({"command": ["set_property", "af", af_value]}).to_string();
        send_ipc_command_with_retry(&cmd, 2).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn download_song(url: String, quality: String, format: Option<String>, embed_thumbnail: Option<bool>, path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let resolved_path = expand_tilde(&path);
        let fmt = format.as_deref().unwrap_or("mp3");
        let do_embed = embed_thumbnail.unwrap_or(true);
        let audio_format = match fmt {
            "opus" => "opus",
            "m4a"  => "m4a",
            "flac" => "flac",
            _      => "mp3",
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
        let mut args = vec![
            "--extract-audio".to_string(),
            "--audio-format".to_string(), audio_format.to_string(),
            "--audio-quality".to_string(), audio_quality.to_string(),
            "--add-metadata".to_string(),
            "--no-check-certificates".to_string(),
            "--no-warnings".to_string(),
            "-o".to_string(), output_template.clone(),
        ];
        if do_embed {
            args.push("--embed-thumbnail".to_string());
        }
        args.push(url.clone());
        let output = Command::new(bin_ytdlp())
            .args(&args)
            .no_window()
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
            let out = Command::new(bin_ytdlp())
                .args(["-f", format, "--extract-audio", "--audio-format", "mp3",
                       "--audio-quality", audio_quality, "--embed-thumbnail", "--add-metadata",
                       "--no-check-certificates", "--no-warnings", "-o", &tpl, &url_clone])
                .no_window()
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
        { Command::new("open").arg(&dir).no_window().spawn().map_err(|e| format!("open failed: {}", e))?; }
        #[cfg(target_os = "windows")]
        { Command::new("explorer.exe").arg(&dir).no_window().spawn().map_err(|e| format!("explorer failed: {}", e))?; }
        #[cfg(target_os = "linux")]
        { Command::new("xdg-open").arg(&dir).no_window().spawn().map_err(|e| format!("xdg-open failed: {}", e))?; }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AudioMetadata { title: String, artist: String, album: String, duration: String }

#[tauri::command]
async fn get_audio_metadata(path: String) -> Result<AudioMetadata, String> {
    tokio::task::spawn_blocking(move || {
        let output = Command::new(bin_ffprobe())
            .args(["-v", "quiet", "-print_format", "json", "-show_format", &path])
            .no_window()
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

#[tauri::command]
async fn get_waveform_thumbnail(path: String) -> Result<Vec<f32>, String> {
    tokio::task::spawn_blocking(move || {
        let output = Command::new(bin_ffmpeg())
            .args(["-i", &path, "-ac", "1", "-ar", "500", "-f", "f32le", "-"])
            .no_window()
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

#[tauri::command]
async fn normalize_file(path: String, output_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let resolved_in  = expand_tilde(&path);
        let resolved_out = expand_tilde(&output_path);
        let out = Command::new(bin_ffmpeg())
            .args(["-i", &resolved_in, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                   "-ar", "44100", "-y", &resolved_out])
            .no_window()
            .output()
            .map_err(|_| "ffmpeg not found".to_string())?;
        if out.status.success() { Ok(()) }
        else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

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
        
        
        while std::time::Instant::now() < deadline {
            if OpenOptions::new().read(true).write(true).open(SOCKET_PATH).is_ok() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        false
    }
}

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
        
        
        
        let file = match OpenOptions::new().read(true).write(true).open(SOCKET_PATH) {
            Ok(f) => f,
            Err(e) => return vec![Err(format!("IPC connect failed: {}", e)); n],
        };

        let mut reader  = BufReader::new(&file);
        let mut results = Vec::with_capacity(n);
        let deadline    = std::time::Instant::now() + std::time::Duration::from_millis(800);

        for cmd in cmds {
            
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

/// Fetch timed lyrics from lrclib.net — returns JSON array of {time, text} objects.
/// Falls back to synced lyrics if timed unavailable. No API key needed.
#[tauri::command]
async fn fetch_lyrics(title: String, artist: String, duration: f64) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("vanguard-player/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}&duration={}",
        title.replace(' ', "+").replace('&', "%26"),
        artist.replace(' ', "+").replace('&', "%26"),
        duration as u64,
    );

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("lrclib: {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // Try synced lyrics first (has timestamps), fall back to plain lyrics
    if let Some(synced) = json["syncedLyrics"].as_str().filter(|s| !s.is_empty()) {
        // Parse LRC format: [mm:ss.xx] line
        let mut lines: Vec<serde_json::Value> = Vec::new();
        for line in synced.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Some(rest) = line.strip_prefix('[') {
                if let Some(end) = rest.find(']') {
                    let ts = &rest[..end];
                    let text = rest[end+1..].trim();
                    // Parse mm:ss.xx
                    let secs: f64 = if let Some(colon) = ts.find(':') {
                        let mins: f64 = ts[..colon].parse().unwrap_or(0.0);
                        let s: f64 = ts[colon+1..].parse().unwrap_or(0.0);
                        mins * 60.0 + s
                    } else { continue; };
                    lines.push(serde_json::json!({"time": secs, "text": text}));
                }
            }
        }
        if !lines.is_empty() {
            return Ok(serde_json::to_string(&lines).unwrap_or_default());
        }
    }

    // Plain lyrics — split into lines with estimated times
    if let Some(plain) = json["plainLyrics"].as_str().filter(|s| !s.is_empty()) {
        let lines: Vec<&str> = plain.lines().filter(|l| !l.trim().is_empty()).collect();
        let total = duration.max(1.0);
        let step = total / lines.len().max(1) as f64;
        let arr: Vec<serde_json::Value> = lines.iter().enumerate()
            .map(|(i, l)| serde_json::json!({"time": i as f64 * step, "text": l.trim()}))
            .collect();
        return Ok(serde_json::to_string(&arr).unwrap_or_default());
    }

    Err("No lyrics found".to_string())
}

/// Search YouTube Music for artists/albums — returns JSON with thumbnails.
/// Uses yt-dlp --flat-playlist on ytsearchX: to get channel/album results.
#[tauri::command]
async fn search_yt_music(query: String, search_type: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        // Append type hint to query for better results
        let full_query = match search_type.as_str() {
            "artist" => format!("{} artist", query),
            "album"  => format!("{} full album", query),
            _        => query.clone(),
        };
        let search_arg = format!("ytsearch15:{}", full_query);
        let mut child = Command::new(bin_ytdlp())
            .args([
                &search_arg,
                "--flat-playlist",
                "--print", "%(title)s====%(uploader)s====%(id)s====%(thumbnails.0.url)s====%(view_count)s",
                "--no-warnings",
                "--no-check-certificates",
                "--socket-timeout", "8",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .no_window()
            .spawn()
            .map_err(|e| format!("yt-dlp not found: {}", e))?;

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(12);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if std::time::Instant::now() > deadline {
                        let _ = child.kill(); let _ = child.wait();
                        return Err("Search timed out".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.trim().is_empty() { return Err("No results".to_string()); }

        // Build JSON array of results
        let items: Vec<serde_json::Value> = stdout.trim().lines().take(10).filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, "====").collect();
            if parts.len() < 3 { return None; }
            let title     = parts[0].trim();
            let uploader  = parts[1].trim();
            let id        = parts[2].trim();
            let thumb     = if parts.len() > 3 { parts[3].trim() } else {
                // Fallback to standard YouTube thumbnail
                &format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", id)
            };
            let thumb = if thumb.starts_with("http") { thumb.to_string() }
                        else { format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", id) };
            Some(serde_json::json!({
                "title": title,
                "uploader": uploader,
                "id": id,
                "thumbnail": thumb,
                "url": format!("https://youtube.com/watch?v={}", id),
            }))
        }).collect();

        Ok(serde_json::to_string(&items).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn ping() -> String { "pong".to_string() }

#[tauri::command]
async fn check_for_update() -> Result<Option<String>, String> {
    let current = env!("CARGO_PKG_VERSION");
    let client = reqwest::Client::builder()
        .user_agent("vanguard-player")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.github.com/repos/ishmweet/vanguard-player/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let latest = json["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');

    if latest.is_empty() || latest == current {
        Ok(None)
    } else {
        Ok(Some(latest.to_string()))
    }
}

#[tauri::command]
async fn set_mpris_metadata(
    title: String,
    artist: String,
    cover_url: String,
    duration_secs: f64,
    playing: bool,
) -> Result<(), String> {
    {
        let mut meta = mpris_meta().lock().unwrap();
        meta.title = title;
        meta.artist = artist;
        meta.cover_url = cover_url;
        meta.duration_us = (duration_secs * 1_000_000.0) as i64;
        meta.playing = playing;
    }
    mpris_notify();
    Ok(())
}

#[tauri::command]
async fn update_mpris_playback(playing: bool) -> Result<(), String> {
    mpris_meta().lock().unwrap().playing = playing;
    mpris_notify();
    Ok(())
}

#[cfg(target_os = "linux")]
fn start_mpris_server(app_handle: tauri::AppHandle) {
    let (tx, rx) = tokio::sync::watch::channel(());
    let _ = MPRIS_TX.set(tx);
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio rt");
        rt.block_on(async move {
            if let Err(e) = run_mpris_server(app_handle, rx).await {
                eprintln!("[vanguard] MPRIS server error: {}", e);
            }
        });
    });
}


#[cfg(target_os = "linux")]
async fn run_mpris_server(
    app_handle: tauri::AppHandle,
    mut rx: tokio::sync::watch::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    use zbus::{ConnectionBuilder, dbus_interface, InterfaceRef};
    use zbus::zvariant::{Value as ZValue, OwnedValue, ObjectPath};

    struct MediaPlayer2;

    #[dbus_interface(name = "org.mpris.MediaPlayer2")]
    impl MediaPlayer2 {
        #[dbus_interface(property)]
        fn can_quit(&self) -> bool { true }
        #[dbus_interface(property)]
        fn can_raise(&self) -> bool { false }
        #[dbus_interface(property)]
        fn has_track_list(&self) -> bool { false }
        #[dbus_interface(property)]
        fn identity(&self) -> &str { "Vanguard Player" }
        #[dbus_interface(property)]
        fn desktop_entry(&self) -> &str { "vanguard-player" }
        #[dbus_interface(property)]
        fn supported_uri_schemes(&self) -> Vec<String> { vec![] }
        #[dbus_interface(property)]
        fn supported_mime_types(&self) -> Vec<String> { vec![] }
        fn quit(&self) {}
        fn raise(&self) {}
    }

    let app_next = app_handle.clone();
    let app_prev = app_handle.clone();
    let app_pp   = app_handle.clone();
    let app_stop = app_handle.clone();

    struct Player {
        app_next: tauri::AppHandle,
        app_prev: tauri::AppHandle,
        app_pp:   tauri::AppHandle,
        app_stop: tauri::AppHandle,
    }

    #[dbus_interface(name = "org.mpris.MediaPlayer2.Player")]
    impl Player {
        #[dbus_interface(property)]
        fn playback_status(&self) -> String {
            if mpris_meta().lock().unwrap().playing { "Playing".into() } else { "Paused".into() }
        }
        #[dbus_interface(property)]
        fn loop_status(&self) -> String { "None".into() }
        #[dbus_interface(property)]
        fn rate(&self) -> f64 { 1.0 }
        #[dbus_interface(property)]
        fn shuffle(&self) -> bool { false }

        #[dbus_interface(property)]
        fn metadata(&self) -> HashMap<String, OwnedValue> {
            let (title, artist, cover_url, duration_us) = {
                let m = mpris_meta().lock().unwrap();
                (m.title.clone(), m.artist.clone(), m.cover_url.clone(), m.duration_us)
            };
            let mut map: HashMap<String, OwnedValue> = HashMap::new();
            map.insert("mpris:trackid".into(),
                OwnedValue::try_from(ZValue::new(ObjectPath::try_from("/org/vanguard/track/1").unwrap())).unwrap());
            map.insert("xesam:title".into(),
                OwnedValue::try_from(ZValue::new(title.as_str())).unwrap());
            map.insert("xesam:artist".into(),
                OwnedValue::try_from(ZValue::new(vec![artist.as_str()])).unwrap());
            if !cover_url.is_empty() {
                map.insert("mpris:artUrl".into(),
                    OwnedValue::try_from(ZValue::new(cover_url.as_str())).unwrap());
            }
            if duration_us > 0 {
                map.insert("mpris:length".into(),
                    OwnedValue::try_from(ZValue::new(duration_us)).unwrap());
            }
            map
        }

        #[dbus_interface(property)]
        fn volume(&self) -> f64 { 1.0 }
        #[dbus_interface(property)]
        fn position(&self) -> i64 {
            send_ipc_command_with_retry(r#"{"command": ["get_property", "time-pos"]}"#, 1)
                .ok()
                .and_then(|r| parse_f64_from_response(&r).ok())
                .map(|s| (s * 1_000_000.0) as i64)
                .unwrap_or(0)
        }
        #[dbus_interface(property)]
        fn minimum_rate(&self) -> f64 { 0.5 }
        #[dbus_interface(property)]
        fn maximum_rate(&self) -> f64 { 2.0 }
        #[dbus_interface(property)]
        fn can_go_next(&self) -> bool { true }
        #[dbus_interface(property)]
        fn can_go_previous(&self) -> bool { true }
        #[dbus_interface(property)]
        fn can_play(&self) -> bool { true }
        #[dbus_interface(property)]
        fn can_pause(&self) -> bool { true }
        #[dbus_interface(property)]
        fn can_seek(&self) -> bool { true }
        #[dbus_interface(property)]
        fn can_control(&self) -> bool { true }

        fn next(&self)       { let _ = self.app_next.emit("mpris_next", ()); }
        fn previous(&self)   { let _ = self.app_prev.emit("mpris_prev", ()); }
        fn play_pause(&self) { let _ = self.app_pp.emit("mpris_play_pause", ()); }
        fn play(&self)       { let _ = self.app_pp.emit("mpris_play_pause", ()); }
        fn pause(&self)      { let _ = self.app_pp.emit("mpris_play_pause", ()); }
        fn stop(&self)       { let _ = self.app_stop.emit("mpris_play_pause", ()); }

        fn seek(&self, offset_us: i64) {
            let cmd = format!(r#"{{"command": ["seek", {}, "relative"]}}"#, offset_us as f64 / 1_000_000.0);
            let _ = send_ipc_command_with_retry(&cmd, 1);
        }
        fn set_position(&self, _track_id: ObjectPath<'_>, position_us: i64) {
            let cmd = format!(r#"{{"command": ["seek", {}, "absolute"]}}"#, position_us as f64 / 1_000_000.0);
            let _ = send_ipc_command_with_retry(&cmd, 1);
        }
        fn open_uri(&self, _uri: String) {}
    }

    let conn = ConnectionBuilder::session()?
        .name("org.mpris.MediaPlayer2.vanguard")?
        .serve_at("/org/mpris/MediaPlayer2", MediaPlayer2)?
        .serve_at("/org/mpris/MediaPlayer2", Player { app_next, app_prev, app_pp, app_stop })?
        .build()
        .await?;

    let player_iface: InterfaceRef<Player> = conn
        .object_server()
        .interface("/org/mpris/MediaPlayer2")
        .await?;

    loop {
        let _ = rx.changed().await;
        let iface = player_iface.get().await;
        let ctxt  = player_iface.signal_context();
        let _ = iface.playback_status_changed(ctxt).await;
        let _ = iface.metadata_changed(ctxt).await;
    }
}

/// Write arbitrary text content to an absolute file path.
/// Used by the frontend backup feature to save JSON directly to the chosen folder.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create directory: {}", e))?;
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("Write failed: {}", e))
}

fn main() {
    
    
    
    init_bin_paths();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

            let handle = app.handle().clone();

            app.manage(tray::init());

            #[cfg(target_os = "linux")]
            start_mpris_server(handle.clone());

            // Pre-warm mpv in background so first play is instant
            std::thread::spawn(|| { ensure_mpv_running(); });


            // Set window icon explicitly — required on Linux for taskbar icon
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tauri::include_image!("icons/128x128.png"));
            }

            let shortcuts = [
                ("MediaPlayPause", "mpris_play_pause"),
                ("MediaNextTrack",  "mpris_next"),
                ("MediaPrevTrack",  "mpris_prev"),
            ];

            for (key, event) in shortcuts {
                if let Ok(shortcut) = key.parse::<Shortcut>() {
                    let h = handle.clone();
                    let ev = event.to_string();
                    let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _sc, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = h.emit(&ev, ());
                        }
                    });
                }
            }



            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            check_for_update,
            set_mpris_metadata,
            update_mpris_playback,
            search_youtube,
            prefetch_track,
            import_csv_playlist,
            import_youtube_playlist,
            open_url_in_browser,
            set_loudnorm_enabled,
            set_skip_silence,
            set_stream_quality,
            get_loudnorm_enabled,
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
            write_text_file,
            fetch_lyrics,
            search_yt_music,
            tray::tray_set,
            audio_device::get_audio_device,
            audio_device::list_audio_devices,
            audio_device::set_audio_device,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // Intercept window close — hide to tray instead of quitting when tray is active
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } if label == "main" => {
                    let flag = app_handle.state::<tray::TrayFlag>();
                    if tray::handle_close_requested(app_handle, &flag) {
                        api.prevent_close();
                    }
                }
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    if let Some(mut child) = mpv_process().lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    #[cfg(unix)]
                    { let _ = std::fs::remove_file(SOCKET_PATH); }
                }
                _ => {}
            }
        });
}