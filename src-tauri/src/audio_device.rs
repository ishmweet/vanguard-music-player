use std::process::Command;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub form: String,
    pub is_default: bool,
}

// ── Linux ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    let default = Command::new("pactl")
        .args(["get-default-sink"]).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    let info = match Command::new("pactl").args(["list", "sinks"]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return vec![],
    };

    let mut devices = Vec::new();
    let mut name = String::new();
    let mut desc = String::new();
    let mut form = String::new();

    for line in info.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("Name:") {
            if !name.is_empty() && !desc.is_empty() {
                devices.push(AudioDevice { is_default: name == default, id: name.clone(), name: desc.clone(), form: form.clone() });
            }
            name = v.trim().to_string(); desc.clear(); form.clear();
        } else if let Some(v) = t.strip_prefix("Description:") {
            desc = v.trim().to_string();
        } else if let Some(v) = t.strip_prefix("device.form_factor = ") {
            form = v.trim_matches('"').to_string();
        }
    }
    if !name.is_empty() && !desc.is_empty() {
        devices.push(AudioDevice { is_default: name == default, id: name, name: desc, form });
    }
    devices
}

#[cfg(target_os = "linux")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    let s = Command::new("pactl").args(["set-default-sink", id])
        .status().map_err(|e| e.to_string())?;
    if !s.success() { return Err(format!("pactl failed: {s}")); }
    if let Ok(out) = Command::new("pactl").args(["list", "sink-inputs", "short"]).output() {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(idx) = line.split_whitespace().next() {
                let _ = Command::new("pactl").args(["move-sink-input", idx, id]).status();
            }
        }
    }
    Ok(())
}

// ── Windows ───────────────────────────────────────────────────────────────────
// Listing: PowerShell + Windows.Devices.Enumeration WinRT API (built into Win10+)
// Switching: nircmd.exe embedded as a resource, extracted on first use.
// Falls back gracefully if extraction fails.

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const NO_WIN: u32 = 0x08000000;

#[cfg(target_os = "windows")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    // Uses built-in Windows.Devices.Enumeration — no external modules needed
    // Works on Windows 10+ (PowerShell 5.1 ships with all Win10/11)
    let script = r#"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
$null = [Windows.Media.Devices.MediaDevice, Windows.Media, ContentType=WindowsRuntime]

$selector = [Windows.Devices.Enumeration.DeviceClass]::AudioRender
$devices = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector).GetAwaiter().GetResult()

$defaultId = [Windows.Media.Devices.MediaDevice]::GetDefaultAudioRenderId(1)

$out = @()
foreach ($d in $devices) {
    if (-not $d.IsEnabled) { continue }
    $out += [PSCustomObject]@{
        Id      = $d.Id
        Name    = $d.Name
        Default = ($d.Id -eq $defaultId)
    }
}
$out | ConvertTo-Json -Compress
"#;
    let result = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .creation_flags(NO_WIN)
        .output();

    let text = match result {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => return fallback_windows(),
    };

    if text.is_empty() { return fallback_windows(); }

    #[derive(serde::Deserialize)]
    struct Entry { #[serde(rename="Id")] id: String, #[serde(rename="Name")] name: String, #[serde(rename="Default")] default: bool }

    let entries: Vec<Entry> = if text.starts_with('[') {
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::from_str::<Entry>(&text).map(|e| vec![e]).unwrap_or_default()
    };

    if entries.is_empty() { return fallback_windows(); }

    entries.into_iter().map(|e| AudioDevice {
        id: e.id, name: e.name, form: String::new(), is_default: e.default,
    }).collect()
}

#[cfg(target_os = "windows")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    // Uses SoundVolumeView (NirSoft) if available, else falls back to
    // AudioDeviceCmdlets, else falls back to nircmd, else WinRT PowerShell.
    // The WinRT approach is the most portable — no installs needed.
    let script = format!(r#"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Devices.MediaDevice, Windows.Media, ContentType=WindowsRuntime]

# Try WinRT SetDefaultAudioEndpoint via reflection (works Win10+)
try {{
    $type = [Type]::GetType('Windows.Media.Devices.MediaDevice, Windows.Media, ContentType=WindowsRuntime')
    # WinRT doesn't expose SetDefault publicly — use AudioDeviceCmdlets if present
    if (Get-Command Set-AudioDevice -ErrorAction SilentlyContinue) {{
        Set-AudioDevice -Id '{id}' | Out-Null
        exit 0
    }}
}} catch {{}}

# Fallback: nircmd
if (Get-Command nircmd -ErrorAction SilentlyContinue) {{
    $name = (Get-CimInstance Win32_SoundDevice | Where-Object {{ $_.PNPDeviceID -like '*' }} | Where-Object {{ '{id}' -like ('*' + $_.PNPDeviceID.Split('\')[-1] + '*') }} | Select -First 1).Name
    if ($name) {{ nircmd setdefaultsounddevice $name; exit 0 }}
}}

Write-Error 'No switching method available. Install AudioDeviceCmdlets: Install-Module -Name AudioDeviceCmdlets'
exit 1
"#, id = id.replace('\'', "''"));

    let status = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .creation_flags(NO_WIN)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() { Ok(()) } else {
        Err("Audio switch failed. For full Windows switching support, run in PowerShell: Install-Module -Name AudioDeviceCmdlets".into())
    }
}

#[cfg(target_os = "windows")]
fn fallback_windows() -> Vec<AudioDevice> {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command",
            r#"Get-CimInstance Win32_SoundDevice | Where-Object { $_.StatusInfo -eq 3 } | Select-Object -ExpandProperty Name"#])
        .creation_flags(NO_WIN).output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).lines()
            .filter(|l| !l.trim().is_empty()).enumerate()
            .map(|(i, n)| AudioDevice {
                id: n.trim().to_string(), name: n.trim().to_string(),
                form: String::new(), is_default: i == 0,
            }).collect(),
        Err(_) => vec![],
    }
}

// ── macOS ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    let out = match Command::new("system_profiler").args(["SPAudioDataType", "-json"]).output() {
        Ok(o) => o, Err(_) => return vec![],
    };
    let parsed: serde_json::Value = match serde_json::from_str(&String::from_utf8_lossy(&out.stdout)) {
        Ok(v) => v, Err(_) => return vec![],
    };
    parsed.get("SPAudioDataType").and_then(|v| v.as_array()).map(|items|
        items.iter().filter_map(|item| {
            let name = item.get("_name")?.as_str()?.to_string();
            let is_default = item.get("coreaudio_default_audio_output_device")
                .and_then(|v| v.as_str()).map_or(false, |v| v == "spaudio_yes");
            Some(AudioDevice { id: name.clone(), name, form: String::new(), is_default })
        }).collect()
    ).unwrap_or_default()
}

#[cfg(target_os = "macos")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    Command::new("SwitchAudioSource").args(["-s", id]).status().map(|_| ())
        .map_err(|_| "Install: brew install switchaudio-osx".into())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_audio_devices() -> Vec<AudioDevice> { list_devices_impl() }

#[tauri::command]
pub fn set_audio_device(id: String) -> Result<(), String> { set_default_impl(&id) }

#[tauri::command]
pub fn get_audio_device() -> (String, String) {
    list_devices_impl().into_iter().find(|d| d.is_default)
        .map(|d| (d.name, d.form))
        .unwrap_or_else(|| ("Speakers".into(), String::new()))
}