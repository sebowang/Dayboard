use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

const GOOGLE_CALLBACK_PORT: u16 = 1421;
const GOOGLE_TOKEN_SERVICE: &str = "Dayboard";
const GOOGLE_TOKEN_ACCOUNT: &str = "google-oauth-tokens";
static GOOGLE_OAUTH_LISTENER_GENERATION: AtomicU64 = AtomicU64::new(0);

fn google_token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(GOOGLE_TOKEN_SERVICE, GOOGLE_TOKEN_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn store_google_tokens(tokens: String) -> Result<(), String> {
    let entry = google_token_entry()?;
    entry.set_password(&tokens).map_err(|error| error.to_string())?;
    let stored = entry.get_password().map_err(|error| error.to_string())?;
    if stored != tokens {
        return Err("Google 授权凭据保存校验失败。".to_string());
    }
    Ok(())
}

#[tauri::command]
fn load_google_tokens() -> Result<Option<String>, String> {
    match google_token_entry()?.get_password() {
        Ok(tokens) => Ok(Some(tokens)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn clear_google_tokens() -> Result<(), String> {
    match google_token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn start_google_oauth_listener(app: tauri::AppHandle) -> Result<(), String> {
    let generation = GOOGLE_OAUTH_LISTENER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // Give a cancelled listener time to release the loopback port before retrying.
    thread::sleep(Duration::from_millis(150));
    let listener = TcpListener::bind(("127.0.0.1", GOOGLE_CALLBACK_PORT))
        .map_err(|_| format!("无法监听 Google 授权回调端口 {}。请关闭占用该端口的程序后重试。", GOOGLE_CALLBACK_PORT))?;
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;

    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline
            && GOOGLE_OAUTH_LISTENER_GENERATION.load(Ordering::SeqCst) == generation
        {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    if let Some(callback_url) = read_google_callback(&mut stream) {
                        let _ = app.emit("google-oauth-callback", callback_url);
                    }
                    let _ = write_callback_response(&mut stream);
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn cancel_google_oauth_listener() {
    GOOGLE_OAUTH_LISTENER_GENERATION.fetch_add(1, Ordering::SeqCst);
}

fn read_google_callback(stream: &mut TcpStream) -> Option<String> {
    let mut request = [0_u8; 8192];
    let bytes_read = stream.read(&mut request).ok()?;
    let request_line = std::str::from_utf8(&request[..bytes_read]).ok()?.lines().next()?;
    let path = request_line.split_whitespace().nth(1)?;
    if !path.starts_with("/oauth/google/callback") {
        return None;
    }
    Some(format!("http://127.0.0.1:{}{}", GOOGLE_CALLBACK_PORT, path))
}

fn write_callback_response(stream: &mut TcpStream) -> std::io::Result<()> {
    const BODY: &str = "<!doctype html><html><body><p>Authorization complete. You can return to Dayboard.</p></body></html>";
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        BODY.len(),
        BODY,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            start_google_oauth_listener,
            cancel_google_oauth_listener,
            store_google_tokens,
            load_google_tokens,
            clear_google_tokens,
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示 Dayboard", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.build(app)?;
            show_main_window(&app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dayboard");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}
