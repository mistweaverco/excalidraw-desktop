// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{Emitter, Manager, Theme, Url, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri::webview::NewWindowResponse;

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(all(desktop, any(windows, target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("deep-link register_all: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, set_theme, open_libraries_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
