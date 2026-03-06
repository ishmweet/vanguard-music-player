use std::process::Command;
use std::os::unix::net::UnixStream;
use std::io::{Write, BufRead, BufReader};

#[tauri::command]
fn search_youtube(query: String) -> Result<String, String> {
    let output = std::process::Command::new("yt-dlp")
        .args([
            &format!("ytsearch10:{}", query),
            "--flat-playlist",
            "--print",
            "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn play_audio(url: String) -> Result<(), String> {
    let _ = Command::new("pkill").arg("mpv").output();
    let _ = std::fs::remove_file("/tmp/mpvsocket");

    // Small delay to ensure socket is cleaned up
    std::thread::sleep(std::time::Duration::from_millis(200));

    Command::new("mpv")
        .args([
            "--no-video",
            "--script-opts=ytdl_hook-ytdl_path=yt-dlp",
            "--ytdl-format=bestaudio/best",
            "--ytdl-raw-options=ignore-config=,no-check-certificates=,format-sort=hasaud:true",
            "--input-ipc-server=/tmp/mpvsocket",
            "--force-window=no",
            &url
        ])
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn pause_audio() -> Result<(), String> {
    send_ipc_command(r#"{"command": ["cycle", "pause"]}"#).map(|_| ())
}

#[tauri::command]
fn get_progress() -> Result<f64, String> {
    let response = send_ipc_command(r#"{"command": ["get_property", "time-pos"]}"#)?;
    parse_f64_from_response(&response)
}

#[tauri::command]
fn get_duration() -> Result<f64, String> {
    let response = send_ipc_command(r#"{"command": ["get_property", "duration"]}"#)?;
    parse_f64_from_response(&response)
}

#[tauri::command]
fn is_paused() -> Result<bool, String> {
    let response = send_ipc_command(r#"{"command": ["get_property", "pause"]}"#)?;
    if response.contains("\"data\":true") {
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn seek_audio(time: f64) -> Result<(), String> {
    let cmd = format!(r#"{{"command": ["set_property", "time-pos", {}]}}"#, time);
    send_ipc_command(&cmd).map(|_| ())
}

#[tauri::command]
fn set_volume(volume: f64) -> Result<(), String> {
    let cmd = format!(r#"{{"command": ["set_property", "volume", {}]}}"#, volume);
    send_ipc_command(&cmd).map(|_| ())
}

#[tauri::command]
fn download_song(url: String, quality: String, path: String) -> Result<String, String> {
    let format = match quality.as_str() {
        "Low" => "worstaudio/worst",
        "Medium" => "bestaudio[abr<=128]/bestaudio/best",
        _ => "bestaudio/best",
    };

    let path_with_slash = if path.ends_with('/') { path } else { format!("{}/", path) };

    let cmd = format!(
        "yt-dlp -f \"{}\" --extract-audio --audio-format mp3 --no-check-certificates -o '{}%(title)s.%(ext)s' {}",
        format, path_with_slash, url
    );

    let output = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("Downloaded successfully".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn parse_f64_from_response(response: &str) -> Result<f64, String> {
    if let Some(data_idx) = response.find("\"data\":") {
        let remainder = &response[data_idx + 7..];
        let num_str = remainder.split(|c| c == ',' || c == '}').next().unwrap_or("");
        if let Ok(val) = num_str.trim().parse::<f64>() {
            return Ok(val);
        }
    }
    Ok(0.0)
}

fn send_ipc_command(cmd: &str) -> Result<String, String> {
    let mut stream = UnixStream::connect("/tmp/mpvsocket").map_err(|e| e.to_string())?;
    stream.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(b"\n").map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    reader.read_line(&mut response).map_err(|e| e.to_string())?;
    Ok(response)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            search_youtube,
            play_audio,
            pause_audio,
            get_progress,
            get_duration,
            is_paused,
            seek_audio,
            set_volume,
            download_song
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = std::process::Command::new("pkill").arg("mpv").output();
                let _ = std::fs::remove_file("/tmp/mpvsocket");
            }
        });
}