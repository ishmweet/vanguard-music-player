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
// Uses Windows Core Audio APIs directly via the `windows` crate.
// IMMDeviceEnumerator for listing, IPolicyConfig (undocumented but stable
// since Vista, used by EarTrumpet/SoundSwitch) for setting default.
// Zero external dependencies, no PowerShell, no installed modules.

#[cfg(target_os = "windows")]
fn com_init() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    // S_FALSE means already initialized on this thread — both outcomes are fine.
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
}

#[cfg(target_os = "windows")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    use windows::{
        Win32::Media::Audio::{
            eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
            DEVICE_STATE_ACTIVE,
        },
        Win32::System::Com::{CoCreateInstance, CoUninitialize, CLSCTX_ALL},
        Win32::UI::Shell::PropertiesSystem::PROPERTYKEY,
        core::GUID,
    };

    com_init();

    // PKEY_Device_FriendlyName = {A45C254E-DF1C-4EFD-8020-67D146A850E0}, pid 14
    let pkey_friendly_name = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    let devices = unsafe {
        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(e) => e,
                Err(_) => { CoUninitialize(); return fallback_windows(); }
            };

        let collection = match enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
            Ok(c) => c,
            Err(_) => { CoUninitialize(); return fallback_windows(); }
        };

        // Get default device ID for comparison
        let default_id = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|d| d.GetId().ok())
            .and_then(|s| s.to_string().ok())
            .unwrap_or_default();

        let count = collection.GetCount().unwrap_or(0);
        let mut out = Vec::with_capacity(count as usize);

        for i in 0..count {
            let dev = match collection.Item(i) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let id = match dev.GetId().and_then(|s| s.to_string()) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let props = match dev.OpenPropertyStore(
                windows::Win32::System::Com::StructuredStorage::STGM_READ
            ) {
                Ok(p) => p,
                Err(_) => continue,
            };
            // Use correctly-typed PROPERTYKEY — avoids the struct-cast bug
            let name = props.GetValue(&pkey_friendly_name)
                .ok()
                .and_then(|pv| {
                    // PropVariantToStringAlloc is the safe way to read VT_LPWSTR
                    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
                    PropVariantToStringAlloc(&pv).ok()
                        .and_then(|s| s.to_string().ok())
                })
                .unwrap_or_else(|| format!("Device {i}"));

            // Detect headphones via endpoint form factor
            // PKEY_AudioEndpoint_FormFactor = {1DA5D803-D492-4EDD-8C23-E0C0FFEE7F0E}, pid 0
            let form_key = PROPERTYKEY {
                fmtid: GUID::from_u128(0x1da5d803_d492_4edd_8c23_e0c0ffee7f0e),
                pid: 0,
            };
            let form = props.GetValue(&form_key).ok()
                .and_then(|pv| {
                    // Form factor is a VT_UI4; value 3 = Headphones, 4 = Headset
                    let v = unsafe { pv.Anonymous.Anonymous.Anonymous.uintVal };
                    match v { 3 | 4 => Some("headphones".to_string()), _ => None }
                })
                .unwrap_or_default();

            out.push(AudioDevice { id: id.clone(), name, form, is_default: id == default_id });
        }

        CoUninitialize();
        out
    };

    if devices.is_empty() { fallback_windows() } else { devices }
}

#[cfg(target_os = "windows")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    use windows::{
        core::{Interface, GUID, HSTRING, PCWSTR},
        Win32::Media::Audio::{eConsole, eMultimedia, eCommunications},
        Win32::System::Com::{CoCreateInstance, CoUninitialize, CLSCTX_ALL},
    };

    // IPolicyConfig — undocumented COM interface, stable Vista → Win11.
    // CLSID: {870AF99C-171D-4F9E-AF0D-E63DF40C2BC9}
    // IID:   {F8679F50-850A-41CF-9C72-430F290290C8}
    #[windows::core::interface("F8679F50-850A-41CF-9C72-430F290290C8")]
    unsafe trait IPolicyConfig: Interface {
        fn _pad0(&self) -> windows::core::HRESULT;
        fn _pad1(&self) -> windows::core::HRESULT;
        fn _pad2(&self) -> windows::core::HRESULT;
        fn _pad3(&self) -> windows::core::HRESULT;
        fn _pad4(&self) -> windows::core::HRESULT;
        fn _pad5(&self) -> windows::core::HRESULT;
        fn _pad6(&self) -> windows::core::HRESULT;
        fn _pad7(&self) -> windows::core::HRESULT;
        fn _pad8(&self) -> windows::core::HRESULT;
        fn _pad9(&self) -> windows::core::HRESULT;
        unsafe fn SetDefaultEndpoint(
            &self,
            device_id: PCWSTR,
            role: windows::Win32::Media::Audio::ERole,
        ) -> windows::core::HRESULT;
        fn _pad10(&self) -> windows::core::HRESULT;
    }

    const POLICY_CONFIG_CLSID: GUID =
        GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    com_init();

    unsafe {
        let policy: IPolicyConfig =
            CoCreateInstance(&POLICY_CONFIG_CLSID, None, CLSCTX_ALL)
                .map_err(|e| { CoUninitialize(); format!("PolicyConfig unavailable: {e}") })?;

        let wide = HSTRING::from(id);
        let pcwstr = PCWSTR(wide.as_ptr());

        // Set all three roles — ignore individual failures, collect errors
        let mut errors = Vec::new();
        for role in [eConsole, eMultimedia, eCommunications] {
            if let Err(e) = policy.SetDefaultEndpoint(pcwstr, role).ok() {
                errors.push(format!("{role:?}: {e}"));
            }
        }

        CoUninitialize();

        // Only fail if ALL three roles failed
        if errors.len() == 3 {
            Err(format!("SetDefaultEndpoint failed for all roles: {}", errors.join(", ")))
        } else {
            Ok(())
        }
    }
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

// ── macOS ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    let out = match Command::new("system_profiler").args(["SPAudioDataType", "-json"]).output() {
        Ok(o) => o,
        Err(_) => return vec![],
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let items = match parsed.get("SPAudioDataType").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => return vec![],
    };
    items.iter().filter_map(|item| {
        let name = item.get("_name")?.as_str()?.to_string();
        let is_default = item.get("coreaudio_default_audio_output_device")
            .and_then(|v| v.as_str()).map_or(false, |v| v == "spaudio_yes");
        Some(AudioDevice { id: name.clone(), name, form: String::new(), is_default })
    }).collect()
}

#[cfg(target_os = "macos")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    // SwitchAudioSource (brew install switchaudio-osx) is the standard CLI tool
    Command::new("SwitchAudioSource")
        .args(["-s", id])
        .status()
        .map(|_| ())
        .map_err(|_| "SwitchAudioSource not found. Install: brew install switchaudio-osx".into())
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