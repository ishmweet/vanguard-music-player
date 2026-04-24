use std::sync::Mutex;
use tauri::{
    Emitter, Manager, AppHandle,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const TRAY_ID: &str = "vanguard-tray";

pub type TrayFlag = Mutex<bool>;

pub fn init() -> TrayFlag {
    Mutex::new(false)
}

fn load_icon() -> Result<tauri::image::Image<'static>, String> {
    let png_bytes = include_bytes!("../icons/icon.png");
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png_bytes as &[u8]));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().map_err(|e| format!("PNG read_info: {e}"))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| format!("PNG decode: {e}"))?;
    let (w, h) = (info.width, info.height);
    let rgba = buf[..info.buffer_size()].to_vec();
    if rgba.len() != (w * h * 4) as usize {
        return Err(format!("Icon size mismatch: {} bytes for {}x{} RGBA", rgba.len(), w, h));
    }
    Ok(tauri::image::Image::new_owned(rgba, w, h))
}

/// Create the tray icon exactly once. Never destroy it — just show/hide.
/// Destroying + recreating causes D-Bus path collision on Linux (duplicate warnings).
fn ensure_created(app: &AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() { return Ok(()); }

    let play_pause_i = MenuItem::with_id(app, "play_pause", "Play / Pause", true, None::<&str>).map_err(|e| e.to_string())?;
    let next_i       = MenuItem::with_id(app, "next",       "Next",         true, None::<&str>).map_err(|e| e.to_string())?;
    let prev_i       = MenuItem::with_id(app, "prev",       "Previous",     true, None::<&str>).map_err(|e| e.to_string())?;
    let sep          = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let show_i       = MenuItem::with_id(app, "show",       "Show",         true, None::<&str>).map_err(|e| e.to_string())?;
    let quit_i       = MenuItem::with_id(app, "quit",       "Quit",         true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&play_pause_i, &next_i, &prev_i, &sep, &show_i, &quit_i])
        .map_err(|e| e.to_string())?;

    let icon = load_icon()?;

    // .build() can panic on Linux when libayatana-appindicator3 is absent.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        TrayIconBuilder::with_id(TRAY_ID)
            .icon(icon)
            .tooltip("Vanguard Player")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "play_pause" => { let _ = app.emit("tray_play_pause", ()); }
                "next"       => { let _ = app.emit("tray_next", ()); }
                "prev"       => { let _ = app.emit("tray_prev", ()); }
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus();
                    }
                }
                "quit" => { app.exit(0); }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up, ..
                } = event {
                    let app = tray.app_handle();
                    if let Some(w) = app.get_webview_window("main") {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.hide();
                        } else {
                            let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus();
                        }
                    }
                }
            })
            .build(app)
    }));

    match result {
        Ok(Ok(_))  => Ok(()),
        Ok(Err(e)) => Err(format!("Tray build error: {e}")),
        Err(_)     => Err("Tray unavailable — on Linux install: libayatana-appindicator3-1".into()),
    }
}

#[tauri::command]
pub fn tray_set(
    app: AppHandle,
    enabled: bool,
    flag: tauri::State<'_, TrayFlag>,
) -> Result<bool, String> {
    if enabled {
        // Create once, then show
        ensure_created(&app)?;
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_visible(true);
        }
        *flag.lock().unwrap() = true;
    } else {
        // Hide — do NOT destroy/remove (avoids D-Bus collision on re-enable)
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_visible(false);
        }
        *flag.lock().unwrap() = false;
    }
    Ok(enabled)
}

/// Call from main.rs RunEvent::WindowEvent { CloseRequested }.
/// Returns true when tray is active → caller must call api.prevent_close().
pub fn handle_close_requested(app: &AppHandle, flag: &TrayFlag) -> bool {
    if !*flag.lock().unwrap() { return false; }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    true
}