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
    let mut cur_name = String::new();
    let mut cur_desc = String::new();
    let mut cur_form = String::new();

    for line in info.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("Name:") {
            if !cur_name.is_empty() && !cur_desc.is_empty() {
                devices.push(AudioDevice {
                    is_default: cur_name == default,
                    id: cur_name.clone(), name: cur_desc.clone(), form: cur_form.clone(),
                });
            }
            cur_name = v.trim().to_string(); cur_desc.clear(); cur_form.clear();
        } else if let Some(v) = t.strip_prefix("Description:") {
            cur_desc = v.trim().to_string();
        } else if let Some(v) = t.strip_prefix("device.form_factor = ") {
            cur_form = v.trim_matches('"').to_string();
        }
    }
    if !cur_name.is_empty() && !cur_desc.is_empty() {
        devices.push(AudioDevice {
            is_default: cur_name == default,
            id: cur_name, name: cur_desc, form: cur_form,
        });
    }
    devices
}

#[cfg(target_os = "linux")]
pub fn set_default_impl(id: &str) -> Result<(), String> {
    let s = Command::new("pactl").args(["set-default-sink", id])
        .status().map_err(|e| e.to_string())?;
    if !s.success() { return Err(format!("pactl set-default-sink failed: {s}")); }
    if let Ok(out) = Command::new("pactl").args(["list", "sink-inputs", "short"]).output() {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let idx = line.split_whitespace().next().unwrap_or("");
            if !idx.is_empty() {
                let _ = Command::new("pactl").args(["move-sink-input", idx, id]).status();
            }
        }
    }
    Ok(())
}

// ── Windows ───────────────────────────────────────────────────────────────────
// Uses IMMDeviceEnumerator (Core Audio) for listing.
// Uses IPolicyConfig COM interface for switching — same as EarTrumpet/SoundSwitch.
// No PowerShell, no external modules, works Win7–Win11.

#[cfg(target_os = "windows")]
fn com_init() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    // S_FALSE = already initialized on this thread — both outcomes fine
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
}

#[cfg(target_os = "windows")]
pub fn list_devices_impl() -> Vec<AudioDevice> {
    use windows::{
        Win32::Media::Audio::{
            eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
        },
        Win32::System::Com::{
            CoCreateInstance, CoUninitialize, CLSCTX_ALL,
            StructuredStorage::{PropVariantToStringAlloc, STGM_READ},
        },
        Win32::System::Variant::VT_UI4,
        core::GUID,
    };

    // PROPERTYKEY is just {GUID, u32} — define inline to avoid needing Win32_UI feature
    #[repr(C)]
    struct PropKey { fmtid: GUID, pid: u32 }

    // PKEY_Device_FriendlyName  {A45C254E-DF1C-4EFD-8020-67D146A850E0}, pid=14
    let pkey_name = PropKey {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14,
    };
    // PKEY_AudioEndpoint_FormFactor {1DA5D803-D492-4EDD-8C23-E0C0FFEE7F0E}, pid=0
    let pkey_form = PropKey {
        fmtid: GUID::from_u128(0x1da5d803_d492_4edd_8c23_e0c0ffee7f0e), pid: 0,
    };

    com_init();

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
        let default_id = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()
            .and_then(|d| d.GetId().ok())
            .and_then(|s| s.to_string().ok())
            .unwrap_or_default();

        let count = collection.GetCount().unwrap_or(0);
        let mut out = Vec::with_capacity(count as usize);

        for i in 0..count {
            let dev = match collection.Item(i) { Ok(d) => d, Err(_) => continue };
            let id = match dev.GetId().and_then(|s| s.to_string()) {
                Ok(s) => s, Err(_) => continue,
            };
            let props = match dev.OpenPropertyStore(STGM_READ) {
                Ok(p) => p, Err(_) => continue,
            };

            // Read friendly name via PropVariantToStringAlloc — safe, handles all VT types
            let name = props.GetValue(&pkey_name as *const PropKey as *const _).ok()
                .and_then(|pv| PropVariantToStringAlloc(&pv).ok())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_else(|| format!("Device {i}"));

            // Form factor: 3=Headphones, 4=Headset
            let form = props.GetValue(&pkey_form as *const PropKey as *const _).ok()
                .and_then(|pv| {
                    if pv.as_raw().Anonymous.Anonymous.vt == VT_UI4.0 {
                        let v = pv.as_raw().Anonymous.Anonymous.Anonymous.uintVal;
                        if v == 3 || v == 4 { return Some("headphones".to_string()); }
                    }
                    None
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
        core::{GUID, HSTRING, PCWSTR},
        Win32::Media::Audio::{eCommunications, eConsole, eMultimedia, ERole},
        Win32::System::Com::{CoCreateInstance, CoUninitialize, CLSCTX_ALL},
    };

    // IPolicyConfig — undocumented but stable COM interface (Vista → Win11)
    // CLSID {870AF99C-171D-4F9E-AF0D-E63DF40C2BC9}
    // IID   {F8679F50-850A-41CF-9C72-430F290290C8}
    // vtable: 3 IUnknown methods + 10 padding + SetDefaultEndpoint at slot 13
    windows::imp::define_interface!(
        IPolicyConfig,
        IPolicyConfig_Vtbl,
        0xf8679f50_850a_41cf_9c72_430f290290c8
    );
    impl IPolicyConfig {
        pub unsafe fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> windows::core::HRESULT {
            (windows::core::Interface::vtable(self).SetDefaultEndpoint)(
                windows::core::Interface::as_raw(self), id, role,
            )
        }
    }
    #[repr(C)]
    struct IPolicyConfig_Vtbl {
        base__: windows::core::IUnknown_Vtbl,
        _pad: [usize; 10],
        SetDefaultEndpoint: unsafe extern "system" fn(
            *mut core::ffi::c_void, PCWSTR, ERole,
        ) -> windows::core::HRESULT,
        _pad2: usize,
    }

    const CLSID: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    com_init();

    unsafe {
        let policy: IPolicyConfig = CoCreateInstance(&CLSID, None, CLSCTX_ALL)
            .map_err(|e| { CoUninitialize(); format!("PolicyConfig: {e}") })?;

        let wide = HSTRING::from(id);
        let pcwstr = PCWSTR(wide.as_ptr());
        let mut errors = 0u32;
        for role in [eConsole, eMultimedia, eCommunications] {
            if policy.SetDefaultEndpoint(pcwstr, role).is_err() { errors += 1; }
        }
        CoUninitialize();
        if errors == 3 { Err("SetDefaultEndpoint failed for all roles".into()) } else { Ok(()) }
    }
}

#[cfg(target_os = "windows")]
fn fallback_windows() -> Vec<AudioDevice> {
    use std::os::windows::process::CommandExt;
    const NO_WIN: u32 = 0x08000000;
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
        .map_err(|_| "SwitchAudioSource not found — install: brew install switchaudio-osx".into())
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