use std::process::Command;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct AudioDevice {
    pub id: String,        // sink name (Linux) / device name (Windows)
    pub name: String,      // human-readable description
    pub form: String,      // headphones / speaker / etc.
    pub is_default: bool,
}

// ── Linux (PulseAudio/PipeWire-pulse) ────────────────────────────────────────

#[cfg(target_os = "linux")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    let default = Command::new("pactl")
        .args(["get-default-sink"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    let info = match Command::new("pactl").args(["list", "sinks"]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return vec![],
    };

    let mut devices = Vec::new();
    let mut cur_name = String::new();
    let mut cur_desc = String::new();
    let mut cur_form = String::new();

    for line in info.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("Name:") {
            // flush previous
            if !cur_name.is_empty() && !cur_desc.is_empty() {
                devices.push(AudioDevice {
                    is_default: cur_name == default,
                    id: cur_name.clone(),
                    name: cur_desc.clone(),
                    form: cur_form.clone(),
                });
            }
            cur_name = v.trim().to_string();
            cur_desc.clear();
            cur_form.clear();
        } else if let Some(v) = t.strip_prefix("Description:") {
            cur_desc = v.trim().to_string();
        } else if let Some(v) = t.strip_prefix("device.form_factor = ") {
            cur_form = v.trim_matches('"').to_string();
        }
    }
    // flush last
    if !cur_name.is_empty() && !cur_desc.is_empty() {
        devices.push(AudioDevice {
            is_default: cur_name == default,
            id: cur_name,
            name: cur_desc,
            form: cur_form,
        });
    }
    devices
}

#[cfg(target_os = "linux")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    // 1. Tell PulseAudio/PipeWire the new default sink
    let s = Command::new("pactl")
        .args(["set-default-sink", id])
        .status()
        .map_err(|e| e.to_string())?;
    if !s.success() {
        return Err(format!("pactl set-default-sink failed: {s}"));
    }
    // 2. Move all existing sink inputs (streams) to the new sink so audio
    //    switches instantly without restarting playback.
    if let Ok(out) = Command::new("pactl").args(["list", "sink-inputs", "short"]).output() {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let idx = line.split_whitespace().next().unwrap_or("");
            if !idx.is_empty() {
                let _ = Command::new("pactl")
                    .args(["move-sink-input", idx, id])
                    .status();
            }
        }
    }
    Ok(())
}

// ── Windows ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    use std::os::windows::process::CommandExt;
    const NO_WIN: u32 = 0x08000000;

    // PowerShell: list all active audio render endpoints
    let script = r#"
$devices = Get-AudioDevice -List 2>$null |
    Where-Object { $_.Type -eq 'Playback' }
if (-not $devices) {
    Get-CimInstance Win32_SoundDevice |
        Where-Object { $_.StatusInfo -eq 3 } |
        Select-Object @{N='Name';E={$_.Name}}, @{N='Id';E={$_.DeviceID}}, @{N='Default';E={$false}} |
        ConvertTo-Json -Compress
} else {
    $def = (Get-AudioDevice -Playback).Id
    $devices | Select-Object @{N='Name';E={$_.Name}}, @{N='Id';E={$_.Id}}, @{N='Default';E={$_.Id -eq $def}} |
        ConvertTo-Json -Compress
}
"#;
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .creation_flags(NO_WIN)
        .output();

    let text = match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => return fallback_windows(),
    };

    // Parse JSON array or single object
    let parse = |s: &str| -> Vec<AudioDevice> {
        #[derive(serde::Deserialize)]
        struct Entry { #[serde(rename="Name")] name: String, #[serde(rename="Id")] id: String, #[serde(rename="Default")] default: bool }
        let entries: Vec<Entry> = if s.starts_with('[') {
            serde_json::from_str(s).unwrap_or_default()
        } else {
            serde_json::from_str::<Entry>(s).map(|e| vec![e]).unwrap_or_default()
        };
        entries.into_iter().map(|e| AudioDevice { id: e.id, name: e.name, form: String::new(), is_default: e.default }).collect()
    };

    let devs = parse(&text);
    if devs.is_empty() { fallback_windows() } else { devs }
}

#[cfg(target_os = "windows")]
fn fallback_windows() -> Vec<AudioDevice> {
    use std::os::windows::process::CommandExt;
    const NO_WIN: u32 = 0x08000000;
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command",
            r#"Get-CimInstance Win32_SoundDevice | Where-Object { $_.StatusInfo -eq 3 } | Select-Object -ExpandProperty Name"#])
        .creation_flags(NO_WIN)
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter(|l| !l.trim().is_empty())
            .enumerate()
            .map(|(i, name)| AudioDevice {
                id: name.trim().to_string(),
                name: name.trim().to_string(),
                form: String::new(),
                is_default: i == 0,
            })
            .collect(),
        Err(_) => vec![],
    }
}

#[cfg(target_os = "windows")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const NO_WIN: u32 = 0x08000000;
    // AudioDeviceCmdlets (Set-AudioDevice) if available, else nircmd fallback
    let script = format!(
        r#"
if (Get-Command Set-AudioDevice -ErrorAction SilentlyContinue) {{
    Set-AudioDevice -Id '{id}'
}} else {{
    $idx = (Get-CimInstance Win32_SoundDevice | Where-Object {{ $_.Name -eq '{id}' }} | Select-Object -First 1).Index
    if ($idx) {{ nircmd setdefaultsounddevice $idx }}
}}
"#,
        id = id.replace('\'', "''")
    );
    Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .creation_flags(NO_WIN)
        .status()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_audio_devices() -> Vec<AudioDevice> {
    list_devices_impl()
}

#[tauri::command]
pub fn set_audio_device(id: String) -> Result<(), String> {
    set_default_impl(&id)
}

// Legacy single-device query kept for any callers that still use it
#[tauri::command]
pub fn get_audio_device() -> (String, String) {
    list_devices_impl()
        .into_iter()
        .find(|d| d.is_default)
        .map(|d| (d.name, d.form))
        .unwrap_or_else(|| ("Speakers".into(), String::new()))
}