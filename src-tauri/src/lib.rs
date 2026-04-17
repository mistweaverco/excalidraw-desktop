// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(desktop)]
use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, Theme, Url, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use serde::{Deserialize, Serialize};
#[cfg(desktop)]
use std::{fs, path::PathBuf};
#[cfg(desktop)]
use tauri::{PhysicalPosition, PhysicalSize, WindowEvent};
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::State;

#[cfg(desktop)]
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedWindowState {
    /// Physical pixels.
    outer_size: Option<(u32, u32)>,
    /// Physical pixels.
    outer_pos: Option<(i32, i32)>,
    maximized: Option<bool>,
    fullscreen: Option<bool>,
}

#[cfg(desktop)]
fn window_state_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|p| p.join("window-state.json"))
}

#[cfg(desktop)]
fn load_window_state(app: &tauri::AppHandle) -> Option<PersistedWindowState> {
    let path = window_state_path(app)?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<PersistedWindowState>(&raw).ok()
}

#[cfg(desktop)]
fn save_window_state(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let path = match window_state_path(app) {
        Some(p) => p,
        None => return,
    };

    // When the window is maximized/fullscreen, `outer_size/outer_pos` are not "normal bounds".
    // Preserve the last known normal bounds and only update the boolean states.
    let prev = load_window_state(app);
    let maximized = window.is_maximized().ok();
    let fullscreen = window.is_fullscreen().ok();
    let is_special = fullscreen == Some(true) || maximized == Some(true);

    let (outer_size, outer_pos) = if is_special {
        (
            prev.as_ref().and_then(|p| p.outer_size),
            prev.as_ref().and_then(|p| p.outer_pos),
        )
    } else {
        (
            window
                .outer_size()
                .ok()
                .map(|s| (s.width as u32, s.height as u32)),
            window
                .outer_position()
                .ok()
                .map(|p| (p.x as i32, p.y as i32)),
        )
    };

    let payload = PersistedWindowState {
        outer_size: outer_size.or(prev.as_ref().and_then(|p| p.outer_size)),
        outer_pos: outer_pos.or(prev.as_ref().and_then(|p| p.outer_pos)),
        maximized,
        fullscreen,
    };

    let dir = match path.parent() {
        Some(d) => d,
        None => return,
    };
    let _ = fs::create_dir_all(dir);
    if let Ok(json) = serde_json::to_string(&payload) {
        let _ = fs::write(path, json);
    }
}

#[cfg(desktop)]
fn restore_window_state(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let Some(st) = load_window_state(app) else {
        return;
    };

    // If we are restoring fullscreen/maximized, skip size/pos. The WM may ignore or apply them
    // in unexpected ways during a state transition.
    if st.fullscreen == Some(true) {
        let _ = window.set_fullscreen(true);
        return;
    }
    if st.maximized == Some(true) {
        let _ = window.maximize();
        return;
    }

    if let Some((w, h)) = st.outer_size {
        let _ = window.set_size(PhysicalSize::new(w, h));
    }
    if let Some((x, y)) = st.outer_pos {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

#[cfg(desktop)]
struct RestoreGate(Mutex<bool>);

#[cfg(desktop)]
#[tauri::command]
fn restore_main_window_state(app: tauri::AppHandle, gate: State<RestoreGate>) -> Result<(), String> {
    // Only restore once per process; the frontend may call this multiple times.
    {
        let mut did = gate.0.lock().map_err(|_| "restore gate poisoned".to_string())?;
        if *did {
            return Ok(());
        }
        *did = true;
    }

    let w = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    restore_window_state(&app, &w);
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn set_theme(app: tauri::AppHandle, theme: Option<String>) -> Result<(), String> {
    let parsed = match theme.as_deref().map(|s| s.trim().to_lowercase()) {
        Some(t) if t == "dark" => Some(Theme::Dark),
        Some(t) if t == "light" => Some(Theme::Light),
        _ => None,
    };
    app.set_theme(parsed);
    Ok(())
}

/// Mirrors `isExcalidrawComAddLibraryInstallUrl` in `+layout.svelte`. The libraries webview
/// loads `libraries.excalidraw.com` (no Svelte layer), so we intercept navigations here.
///
/// Install handoff is not only `excalidraw.com/?addLibrary=…`: the directory may use
/// `tauri://localhost/#addLibrary=<url-encoded .excalidrawlib URL>&token=…` or
/// `libraries.excalidraw.com` with the same params.
#[cfg(desktop)]
fn is_excalidraw_com_add_library_install_url(u: &Url) -> bool {
    if !url_has_add_library_key(u) {
        return false;
    }
    if u.scheme() == "tauri" {
        return true;
    }
    let host = u.host_str().unwrap_or("");
    let host = host.strip_prefix("www.").unwrap_or(host);
    host == "excalidraw.com"
        || host.ends_with(".excalidraw.com")
        || host == "localhost"
        || host == "127.0.0.1"
}

#[cfg(desktop)]
fn url_has_add_library_key(u: &Url) -> bool {
    for (k, _) in u.query_pairs() {
        if k == "addLibrary" {
            return true;
        }
    }
    if let Some(frag) = u.fragment() {
        let frag = frag.trim_start_matches('#');
        for pair in frag.split('&') {
            let key = pair.split('=').next().unwrap_or("");
            if key == "addLibrary" {
                return true;
            }
        }
    }
    false
}

#[cfg(desktop)]
#[tauri::command]
async fn open_libraries_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed: Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    let external = WebviewUrl::External(parsed);

    if let Some(w) = app.get_webview_window("libraries") {
        let _ = w.close();
    }

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let app_nav = app.clone();
    let app_new = app.clone();

    WebviewWindowBuilder::new(&app, "libraries", external)
        .title("Excalidraw libraries")
        .inner_size(1000.0, 800.0)
        .center()
        // Remote content (libraries.excalidraw.com) has no in-webview close UI. Keep native
        // decorations so the user can close the window.
        .decorations(true)
        .resizable(true)
        .parent(&main)
        .map_err(|e| e.to_string())?
        .on_navigation(move |nav_url| {
            if is_excalidraw_com_add_library_install_url(nav_url) {
                let _ = app_nav.emit_to(
                    "main",
                    "excalidraw-library-install",
                    nav_url.as_str().to_string(),
                );
                if let Some(m) = app_nav.get_webview_window("main") {
                    let _ = m.set_focus();
                }
                return false;
            }
            true
        })
        .on_new_window(move |nav_url, _| {
            if is_excalidraw_com_add_library_install_url(&nav_url) {
                let _ = app_new.emit_to(
                    "main",
                    "excalidraw-library-install",
                    nav_url.as_str().to_string(),
                );
                if let Some(m) = app_new.get_webview_window("main") {
                    let _ = m.set_focus();
                }
                return NewWindowResponse::Deny;
            }
            NewWindowResponse::Allow
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
async fn open_libraries_window(_app: tauri::AppHandle, _url: String) -> Result<(), String> {
    Err("libraries window is only available on desktop".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| w.set_focus());
        }));
    }

    builder = builder.plugin(tauri_plugin_deep_link::init());

    builder
        .manage(RestoreGate(Mutex::new(false)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                // Force frameless at runtime too (some Linux setups can ignore config-only).
                if let Some(w) = app.get_webview_window("main") {
                    if let Err(e) = w.set_decorations(false) {
                        eprintln!("main window set_decorations(false): {e}");
                    }

                    // Persist on close. Restore is triggered by the frontend once it is mounted.
                    let app_handle = app.handle().clone();
                    let w_for_cb = w.clone();
                    w.on_window_event(move |ev| {
                        if matches!(ev, WindowEvent::CloseRequested { .. }) {
                            save_window_state(&app_handle, &w_for_cb);
                        }
                    });
                }
            }
            #[cfg(all(desktop, any(windows, target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("deep-link register_all: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_theme,
            open_libraries_window,
            restore_main_window_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
