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
            // Keep ==== delimiter to prevent breaking on titles containing common symbols
            "%(title)s====%(uploader)s====%(duration_string)s====%(id)s",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn play_audio(url: String) -> Result<(), String> {
    // Kill existing instances to prevent audio overlapping
    let _ = Command::new("pkill").arg("mpv").output();
    
    // Clean up old socket to ensure fresh IPC connection
    let _ = std::fs::remove_file("/tmp/mpvsocket");

    Command::new("mpv")
        .args([
            "--no-video", 
            "--script-opts=ytdl_hook-ytdl_path=yt-dlp",
            // SMART FORMAT SELECTION: 
            // prioritizing best standalone audio, then falling back to best combined
            "--ytdl-format=bestaudio/best",
            // FIXED RAW OPTIONS: Removed complex nested commas that caused parsing errors
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
    if let Some(data_idx) = response.find("\"data\":") {
        let remainder = &response[data_idx + 7..];
        let num_str = remainder.split(|c| c == ',' || c == '}').next().unwrap_or("");
        if let Ok(time) = num_str.parse::<f64>() {
            return Ok(time);
        }
    }
    Ok(0.0)
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
    // SMART DOWNLOAD FORMATS: 
    // Always include a fallback to /best to ensure the download doesn't fail 
    // if a specific audio-only stream is missing.
    let format = match quality.as_str() {
        "Low" => "worstaudio/worst",
        "Medium" => "bestaudio[abr<=128]/bestaudio/best",
        _ => "bestaudio/best",
    };

    let path_with_slash = if path.ends_with('/') {
        path
    } else {
        format!("{}/", path)
    };

    // Robust download command
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

// Helper function to send commands to mpv's Unix socket
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