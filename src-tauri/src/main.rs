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

lazy_static::lazy_static! {
    static ref PREFETCH_CACHE: Arc<Mutex<HashMap<String, String>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Sleep timer: stores the instant at which we should pause playback.
    static ref SLEEP_TIMER: Arc<Mutex<Option<std::time::Instant>>> =
        Arc::new(Mutex::new(None));
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
            if !stream_url.is_empty() {
                cache.lock().unwrap().insert(url, stream_url);
            }
        }
    });
    Ok(())
}

// ── Playback ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn play_audio(url: String) -> Result<(), String> {
    // If somehow a local:// URL is passed, route it to local file playback
    if url.starts_with("local://") {
        let path = url.trim_start_matches("local://").to_string();
        return play_local_file(path).await;
    }

    tokio::task::spawn_blocking(move || {
        let actual_url = {
            let mut cache = PREFETCH_CACHE.lock().unwrap();
            cache.remove(&url).unwrap_or_else(|| url.clone())
        };

        kill_mpv();
        cleanup_socket();

        Command::new("mpv")
            .args([
                "--no-video",
                // Streaming buffer — enough to absorb network jitter without huge latency
                "--cache=yes",
                "--cache-secs=60",
                "--demuxer-max-bytes=32MiB",
                "--demuxer-max-back-bytes=8MiB",
                "--demuxer-readahead-secs=10",
                // Never pause on cache underrun
                "--cache-pause=no",
                // Network resilience
                "--network-timeout=30",
                "--audio-buffer=1",
                "--audio-pitch-correction=yes",
                "--af=loudnorm=I=-16:TP=-1.5:LRA=11",
                "--script-opts=ytdl_hook-ytdl_path=yt-dlp",
                // prefer opus/webm → lower startup latency than mp4a
                "--ytdl-format=bestaudio[ext=webm]/bestaudio/best",
                "--ytdl-raw-options=ignore-config=,no-check-certificates=,retries=5,fragment-retries=5",
                &format!("--input-ipc-server={}", SOCKET_PATH),
                "--force-window=no",
                // Keep process alive after EOF so eof-reached property stays readable
                "--keep-open=yes",
                "--idle=yes",
                &actual_url,
            ])
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        // Wait until the IPC socket is ready (up to 3s) instead of a fixed sleep.
        wait_for_socket(3000);

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn play_local_file(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Strip local:// prefix if present (defensive — frontend should not send it)
        let clean_path = path.trim_start_matches("local://").to_string();
        let resolved = expand_tilde(&clean_path);
        kill_mpv();
        cleanup_socket();

        Command::new("mpv")
            .args([
                "--no-video",
                "--cache=yes",
                "--cache-secs=30",
                "--demuxer-max-bytes=20MiB",
                "--audio-buffer=0.5",
                "--audio-pitch-correction=yes",
                "--af=loudnorm=I=-16:TP=-1.5:LRA=11",
                &format!("--input-ipc-server={}", SOCKET_PATH),
                "--force-window=no",
                // Keep open so eof-reached is readable
                "--keep-open=yes",
                "--idle=yes",
                &resolved,
            ])
            .spawn()
            .map_err(|e| format!("mpv not found or failed to start: {}", e))?;

        // Wait until the IPC socket is ready instead of a fixed sleep.
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
    tokio::task::spawn_blocking(move || {
        let cmd = format!(r#"{{"command": ["seek", {}, "absolute"]}}"#, time);
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
    tokio::task::spawn_blocking(move || {
        let cmd = format!(r#"{{"command": ["set_property", "volume", {}]}}"#, volume);
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
    tokio::task::spawn_blocking(|| {
        let paused = match send_ipc_command_with_retry(
            r#"{"command": ["get_property", "pause"]}"#, 1
        ) {
            Ok(r) => {
                let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null);
                j["data"].as_bool().unwrap_or(false)
            }
            Err(_) => return Err("mpv not running".to_string()),
        };

        let position = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "time-pos"]}"#, 1
        )
        .ok()
        .and_then(|r| parse_f64_from_response(&r).ok())
        .unwrap_or(0.0);

        let duration = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "duration"]}"#, 1
        )
        .ok()
        .and_then(|r| parse_f64_from_response(&r).ok())
        .unwrap_or(0.0);

        let eof_reached = send_ipc_command_with_retry(
            r#"{"command": ["get_property", "eof-reached"]}"#, 1
        )
        .ok()
        .and_then(|r| {
            let j: Value = serde_json::from_str(&r).unwrap_or(Value::Null);
            j["data"].as_bool()
        })
        .unwrap_or(false);

        // With --keep-open mpv pauses at the last frame instead of exiting.
        // Treat it as EOF if eof-reached is true OR position is within 0.8s of
        // the end and the player is paused (i.e. keep-open froze playback there).
        let near_end = duration > 0.0 && position > 3.0 && (duration - position) < 0.5;
        let effective_eof = eof_reached || (near_end && paused);

        Ok(PlaybackState { playing: !paused, paused, position, duration, eof_reached: effective_eof })
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
    *SLEEP_TIMER.lock().unwrap() = Some(deadline);

    // Spawn a background task that fires when the timer expires
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
        // Check if the timer wasn't cancelled in the meantime
        let still_set = SLEEP_TIMER.lock().unwrap()
            .map(|d| d <= std::time::Instant::now())
            .unwrap_or(false);
        if still_set {
            let _ = tokio::task::spawn_blocking(|| {
                send_ipc_command_with_retry(r#"{"command": ["set_property", "pause", true]}"#, 2)
            })
            .await;
            *SLEEP_TIMER.lock().unwrap() = None;
        }
    });

    Ok(())
}

#[tauri::command]
async fn cancel_sleep_timer() -> Result<(), String> {
    *SLEEP_TIMER.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn get_sleep_timer_remaining() -> Result<i64, String> {
    let remaining = SLEEP_TIMER.lock().unwrap().map(|deadline| {
        let now = std::time::Instant::now();
        if deadline > now {
            (deadline - now).as_secs() as i64
        } else {
            0
        }
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
    { let _ = Command::new("pkill").args(["-KILL", "mpv"]).output(); }
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
    #[cfg(unix)]
    {
        let stream = UnixStream::connect(SOCKET_PATH)
            .map_err(|e| format!("IPC connect failed: {}", e))?;
        stream.set_read_timeout(Some(std::time::Duration::from_millis(1500)))
            .map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(std::time::Duration::from_millis(1500)))
            .map_err(|e| e.to_string())?;
        let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
        writer.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
        writer.write_all(b"\n").map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        reader.read_line(&mut response).map_err(|e| e.to_string())?;
        Ok(response)
    }

    #[cfg(windows)]
    {
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(SOCKET_PATH)
            .map_err(|e| format!("IPC connect failed: {}", e))?;
        file.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(file);
        let mut response = String::new();
        reader.read_line(&mut response).map_err(|e| e.to_string())?;
        Ok(response)
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

            for (mgr, pkg_args, pip_args) in pkg_managers {
                if Command::new("which").arg(mgr).output().map(|o| o.status.success()).unwrap_or(false) {
                    // Try with sudo, fall back without
                    let result = Command::new("sudo").args(*pkg_args).output()
                        .or_else(|_| Command::new(pkg_args[0]).args(&pkg_args[1..]).output());
                    match result {
                        Ok(out) => {
                            log.push_str(&String::from_utf8_lossy(&out.stdout));
                            log.push_str(&String::from_utf8_lossy(&out.stderr));
                            // Install yt-dlp via pip
                            let _ = Command::new("sudo").args(*pip_args).output()
                                .or_else(|_| Command::new(pip_args[0]).args(&pip_args[1..]).output());
                            // Also try direct yt-dlp installer
                            if !Command::new("yt-dlp").arg("--version").output().is_ok() {
                                let _ = Command::new("pip3").args(["install", "--upgrade", "yt-dlp"]).output();
                                let _ = Command::new("pip").args(["install", "--upgrade", "yt-dlp"]).output();
                            }
                            installed = true;
                        }
                        Err(e) => { log.push_str(&format!("Error with {}: {}\n", mgr, e)); }
                    }
                    break;
                }
            }

            // Fallback: try pip/pip3 directly for yt-dlp
            if !Command::new("yt-dlp").arg("--version").output().is_ok() {
                let _ = Command::new("pip3").args(["install", "--upgrade", "yt-dlp"]).output();
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

            // Install yt-dlp via pip regardless
            let _ = Command::new("pip").args(["install", "--upgrade", "yt-dlp"]).output();
            let _ = Command::new("pip3").args(["install", "--upgrade", "yt-dlp"]).output();
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
                if ffprobe { "✓" } else { "✗" }
            );

            Ok(InstallResult { success, message: msg })
        }

        #[cfg(target_os = "macos")]
        {
            // brew install mpv ffmpeg yt-dlp
            let brew = Command::new("brew")
                .args(["install", "mpv", "ffmpeg", "yt-dlp"])
                .output();
            match brew {
                Ok(out) => {
                    let mpv = Command::new("mpv").arg("--version").output().is_ok();
                    let yt_dlp = Command::new("yt-dlp").arg("--version").output().is_ok();
                    let ffprobe = Command::new("ffprobe").arg("-version").output().is_ok();
                    Ok(InstallResult {
                        success: mpv || yt_dlp,
                        message: format!(
                            "brew install complete.\nmpv: {}  yt-dlp: {}  ffprobe: {}",
                            if mpv { "✓" } else { "✗" },
                            if yt_dlp { "✓" } else { "✗" },
                            if ffprobe { "✓" } else { "✗" }
                        )
                    })
                }
                Err(_) => Ok(InstallResult {
                    success: false,
                    message: "Homebrew not found. Install from https://brew.sh then run: brew install mpv ffmpeg yt-dlp".to_string()
                })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Dependencies
            check_dependencies,
            install_dependencies,
            get_yt_dlp_version,
            update_yt_dlp,
            // Search & prefetch
            search_youtube,
            prefetch_track,
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
            if let tauri::RunEvent::Exit = event {
                kill_mpv();
                #[cfg(unix)]
                { let _ = std::fs::remove_file(SOCKET_PATH); }
            }
        });
}