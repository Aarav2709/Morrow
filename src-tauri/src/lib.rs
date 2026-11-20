// morrow's native side: the window, the vault on disk, sync, the assistant's network calls and updates.
// the interface reaches it only through the commands below, the same calls the electron versions answered
// a phone leaves out the window, tray and keychain parts, which leaves a few helpers unused there
#![cfg_attr(mobile, allow(dead_code, unused_mut))]

mod ai;
mod background;
mod cloud;
#[cfg(target_os = "android")]
mod device;
mod mcp;
mod native;
mod paths;
mod spell;
mod sync;
mod updates;
mod vault;

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const KEEP_BACKUPS: usize = 20;
const MAX_BACKUP_BYTES: usize = 512 * 1024 * 1024;
const MAX_PASTED_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const FILE_SCHEME: &str = "morrow-file";

// the window's first colours, before the interface says which theme it uses
const LIGHT: tauri::window::Color = tauri::window::Color(0xf8, 0xf8, 0xf7, 0xff);
const DARK: tauri::window::Color = tauri::window::Color(0x20, 0x20, 0x20, 0xff);

static READY_TO_CLOSE: AtomicBool = AtomicBool::new(false);

type Res<T> = Result<T, String>;

fn platform() -> &'static str {
    // the names node used, which the interface already knows
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window("main")
}

fn to_window<R: Runtime>(app: &AppHandle<R>, event: &str, payload: impl serde::Serialize + Clone) {
    let _ = app.emit_to("main", event, payload);
}

fn command<R: Runtime>(app: &AppHandle<R>, id: &str) {
    to_window(app, "morrow:command", id.to_string());
}

fn bring_forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        #[cfg(desktop)]
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// the sites shown in a page's frames, websites and youtube videos, which may load in the window
fn framed_sites() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SITES: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    SITES.get_or_init(|| {
        std::sync::Mutex::new(std::collections::HashSet::from([
            "https://www.youtube-nocookie.com".to_string(),
        ]))
    })
}

fn site_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    (parsed.scheme() == "https").then(|| parsed.origin().ascii_serialization())
}

fn framed(url: &str) -> bool {
    site_of(url).is_some_and(|site| {
        framed_sites()
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .contains(&site)
    })
}

// a website about to be shown in a page's frame. its frames are sandboxed, they can't move the window
#[tauri::command]
fn allow_frame(url: String) -> bool {
    let Some(site) = site_of(&url) else {
        return false;
    };
    framed_sites()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .insert(site);
    true
}

// the quick capture box, made the first time and kept hidden between notes. it shows the same app as the
// main window, which sees it is the box and draws only that
#[cfg(desktop)]
fn open_capture<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("morrow:capture-open", ());
        return;
    }
    let script = format!(
        "{} Object.defineProperty(window, '__MORROW_CAPTURE__', {{ value: true }});",
        info_script()
    );
    let built = WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("index.html".into()))
        .title("Quick capture")
        .inner_size(560.0, 196.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .initialization_script(script)
        .disable_drag_drop_handler();
    // the same web view as the main window's, which windows only shares when it was started the same way
    #[cfg(windows)]
    let built = built.additional_browser_args(&native::browser_args());
    let built = built.build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            eprintln!("the quick capture box could not open: {error}");
            return;
        }
    };
    {
        let dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
        let _ = window.set_background_color(Some(if dark { DARK } else { LIGHT }));
        let _ = window.show();
        let _ = window.set_focus();
        // clicking away puts it back out of sight, the way the system's own boxes go
        let handle = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = handle.hide();
            }
        });
    }
}

#[cfg(not(desktop))]
fn open_capture<R: Runtime>(_app: &AppHandle<R>) {}

// the quick capture box opened from inside morrow, the same as its shortcut from anywhere. async, a window
// made while a command holds the main thread would wait on it forever on windows
#[tauri::command]
async fn capture_open<R: Runtime>(app: AppHandle<R>) {
    open_capture(&app);
}

// a note from the quick capture box goes to today's note, which the main window writes
#[tauri::command]
fn capture_submit<R: Runtime>(app: AppHandle<R>, text: String) {
    to_window(&app, "morrow:capture-text", text);
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn capture_hide<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundSettings {
    // morrow opens when the computer starts
    launch_at_startup: bool,
    start_minimized: bool,
    quick_capture: bool,
}

#[tauri::command]
fn background_settings<R: Runtime>(app: AppHandle<R>) -> BackgroundSettings {
    let saved = background::read();
    #[cfg(desktop)]
    let launch_at_startup = {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch().is_enabled().unwrap_or(false)
    };
    #[cfg(not(desktop))]
    let launch_at_startup = {
        let _ = &app;
        false
    };
    BackgroundSettings {
        launch_at_startup,
        start_minimized: saved.start_minimized,
        quick_capture: saved.quick_capture,
    }
}

#[tauri::command]
fn set_background_settings<R: Runtime>(app: AppHandle<R>, settings: BackgroundSettings) -> Res<()> {
    background::write(&background::Background {
        start_minimized: settings.start_minimized,
        quick_capture: settings.quick_capture,
    })?;
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let launcher = app.autolaunch();
        if settings.launch_at_startup != launcher.is_enabled().unwrap_or(false) {
            if settings.launch_at_startup {
                launcher.enable().map_err(|error| error.to_string())?;
            } else {
                launcher.disable().map_err(|error| error.to_string())?;
            }
        }
        let shortcuts = app.global_shortcut();
        let registered = shortcuts.is_registered(background::CAPTURE_SHORTCUT);
        if settings.quick_capture && !registered {
            shortcuts
                .register(background::CAPTURE_SHORTCUT)
                .map_err(|error| error.to_string())?;
        } else if !settings.quick_capture && registered {
            let _ = shortcuts.unregister(background::CAPTURE_SHORTCUT);
        }
    }
    #[cfg(not(desktop))]
    let _ = &app;
    Ok(())
}

fn is_web_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

// blocking work, files above all, runs off the threads that answer the interface
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

// ---- the app

#[tauri::command]
fn close_ready<R: Runtime>(app: AppHandle<R>) {
    READY_TO_CLOSE.store(true, Ordering::SeqCst);
    if let Some(window) = main_window(&app) {
        let _ = window.close();
    }
}

#[tauri::command]
fn set_theme<R: Runtime>(window: WebviewWindow<R>, theme: String, color: Option<String>) {
    // the page's own colour when it sends one, a colour theme changes it
    let page = color.filter(|hex| {
        hex.len() == 7 && hex.starts_with('#') && hex[1..].chars().all(|c| c.is_ascii_hexdigit())
    });
    let background = page
        .as_deref()
        .and_then(|hex| {
            let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
            Some(tauri::window::Color(
                channel(1)?,
                channel(3)?,
                channel(5)?,
                0xff,
            ))
        })
        .unwrap_or(if theme == "dark" { DARK } else { LIGHT });
    let _ = window.set_background_color(Some(background));
    #[cfg(target_os = "android")]
    {
        let dark = theme == "dark";
        // the colour of the page itself, so the strips beside the notch and behind the status bar read as
        // part of it
        let hex = page.unwrap_or_else(|| if dark { "#191919" } else { "#ffffff" }.to_string());
        device::set_theme(window.app_handle(), dark, hex);
    }
}

#[derive(serde::Serialize)]
struct SpellLanguages {
    chosen: Vec<String>,
    system: Vec<String>,
    // the system checks in all its languages by itself and there is nothing to pick, as on macos
    automatic: bool,
    // morrow checks the page's words itself, with a dictionary fetched for each language, as on windows
    own: bool,
}

#[tauri::command]
fn spell_languages() -> SpellLanguages {
    SpellLanguages {
        chosen: native::chosen_spell_languages(),
        system: native::system_spell_languages(),
        automatic: !cfg!(any(target_os = "linux", windows)),
        own: cfg!(windows),
    }
}

// true when the languages only apply once morrow opens again
#[tauri::command]
fn set_spell_languages<R: Runtime>(
    window: WebviewWindow<R>,
    languages: Vec<String>,
) -> Result<bool, String> {
    spell::forget_failures();
    native::set_spell_languages(&window, &languages)
}

// the words of a page no language picked for spelling knows, on windows where the web view can't check
// several languages
#[tauri::command]
async fn spell_check(words: Vec<String>) -> spell::Checked {
    spell::check(words).await
}

#[tauri::command]
async fn spell_suggest(word: String) -> Vec<String> {
    spell::suggest(word).await
}

#[tauri::command]
fn spell_add(word: String) -> Res<()> {
    spell::add_word(&word)
}

#[tauri::command]
fn set_zoom<R: Runtime>(window: WebviewWindow<R>, factor: f64) {
    let _ = window.set_zoom(factor.clamp(0.3, 5.0));
}

#[tauri::command]
fn open_external<R: Runtime>(app: AppHandle<R>, url: String) {
    if is_web_url(&url) {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

#[tauri::command]
fn copy_text<R: Runtime>(app: AppHandle<R>, text: String) -> bool {
    app.clipboard().write_text(text).is_ok()
}

const CLIPBOARD_MEDIA: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "mp3", "wav", "ogg", "m4a", "flac",
    "mp4", "webm", "mov", "m4v", "pdf",
];

// pictures, sound, video and pdfs copied in the file manager, by path
#[tauri::command]
fn clipboard_files() -> Vec<String> {
    native::clipboard_files()
        .into_iter()
        .filter(|path| {
            Path::new(path)
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| CLIPBOARD_MEDIA.contains(&ext.to_ascii_lowercase().as_str()))
        })
        .collect()
}

// one of those files, read only while it is still on the clipboard, so the page can't read any other file
#[tauri::command]
fn read_clipboard_file(path: String) -> Res<Response> {
    if !clipboard_files().contains(&path) {
        return Err("Not on the clipboard.".into());
    }
    let size = std::fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if size > 100 * 1024 * 1024 {
        return Err("Too large.".into());
    }
    Ok(Response::new(
        std::fs::read(&path).map_err(|error| error.to_string())?,
    ))
}

// text and html together, so pictures copied with the words reach other apps too. this comes just after
// the web view wrote its own copy, and on windows the clipboard can still be held by it for a moment, so a
// write that fails is tried again rather than leaving the copy without its pictures
#[tauri::command]
async fn copy_rich<R: Runtime>(app: AppHandle<R>, text: String, html: String) -> bool {
    for _ in 0..12 {
        if app
            .clipboard()
            .write_html(html.clone(), Some(text.clone()))
            .is_ok()
        {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
    false
}

// a calendar subscribed to by its address, such as the secret .ics link google calendar or outlook give.
// fetched here rather than in the page, which those servers refuse. webcal:// is the same as https://
#[tauri::command]
async fn fetch_calendar(url: String) -> Res<String> {
    let lower = url.to_ascii_lowercase();
    let url = if lower.starts_with("webcal://") {
        format!("https://{}", &url["webcal://".len()..])
    } else if lower.starts_with("https://") || lower.starts_with("http://") {
        url
    } else {
        return Err("Not allowed.".into());
    };
    let client = reqwest::Client::builder()
        .user_agent(concat!("Morrow/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("The calendar answered {}.", response.status()));
    }
    if response.content_length().unwrap_or(0) > 8 * 1024 * 1024 {
        return Err("Too large.".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Too large.".into());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !text.trim_start().starts_with("BEGIN:VCALENDAR") {
        return Err("Not a calendar.".into());
    }
    Ok(text)
}

// a picture another app put on the clipboard as a file on this computer, the way word, outlook and
// libreoffice copy the pictures among words. read only when the clipboard's html names that very file, so
// the page can't read any other one
#[tauri::command]
fn read_pasted_picture(src: String) -> Res<Response> {
    #[cfg(mobile)]
    {
        let _ = src;
        Err("Not available on this phone.".into())
    }
    #[cfg(desktop)]
    read_pasted_file(&src)
}

#[cfg(desktop)]
fn read_pasted_file(src: &str) -> Res<Response> {
    let src = src.to_string();
    let html = arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.get().html())
        .map_err(|error| error.to_string())?;
    if !html.contains(&src) && !html.contains(&src.replace('&', "&amp;")) {
        return Err("Not on the clipboard.".into());
    }
    let path = url::Url::parse(&src)
        .ok()
        .filter(|url| url.scheme() == "file")
        .and_then(|url| url.to_file_path().ok())
        .ok_or_else(|| "Not a file.".to_string())?;
    let picture = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            [
                "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "tif", "tiff",
            ]
            .contains(&ext.to_ascii_lowercase().as_str())
        });
    if !picture {
        return Err("Not a picture.".into());
    }
    let size = std::fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if size as usize > MAX_PASTED_IMAGE_BYTES {
        return Err("Too large.".into());
    }
    Ok(Response::new(
        std::fs::read(&path).map_err(|error| error.to_string())?,
    ))
}

// a picture pasted from the web or another app is saved into the vault, so it stays when its link expires.
// the start of a web page, for the title and description a bookmark or a link mention shows. only asked
// for when a link is turned into one, opening a page never contacts anyone
#[tauri::command]
async fn fetch_page_head(url: String) -> Res<String> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err("Not allowed.".into());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (compatible; Morrow/",
            env!("CARGO_PKG_VERSION"),
            ")"
        ))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(&url)
        .header("accept", "text/html")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let html = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("html"));
    if !response.status().is_success() || !html {
        return Err("Not a page.".into());
    }
    // the head is near the top, the rest of a long page is never read
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > 512 * 1024 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// fetched here rather than in the page, which most image hosts would refuse
#[tauri::command]
async fn fetch_image(url: String) -> Res<Response> {
    if !url.to_ascii_lowercase().starts_with("http://")
        && !url.to_ascii_lowercase().starts_with("https://")
    {
        return Err("Not allowed.".into());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Morrow/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let kind = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !response.status().is_success() || !kind.starts_with("image/") {
        return Err("Not a picture.".into());
    }
    if response.content_length().unwrap_or(0) as usize > MAX_PASTED_IMAGE_BYTES {
        return Err("Too large.".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_PASTED_IMAGE_BYTES {
        return Err("Too large.".into());
    }
    // the type goes first, on a line of its own, then the bytes
    let mut body = format!("{kind}\n").into_bytes();
    body.extend_from_slice(&bytes);
    Ok(Response::new(body))
}

#[tauri::command]
fn show_data_folder<R: Runtime>(app: AppHandle<R>) {
    let _ = app
        .opener()
        .open_path(paths::data_dir().to_string_lossy(), None::<&str>);
}

fn backups_dir() -> PathBuf {
    paths::data_dir().join("Backups")
}

#[tauri::command]
fn show_backups<R: Runtime>(app: AppHandle<R>) {
    let _ = std::fs::create_dir_all(backups_dir());
    let _ = app
        .opener()
        .open_path(backups_dir().to_string_lossy(), None::<&str>);
}

// writes to a temporary file first so a crash never leaves a half written backup, keeps the last twenty
#[tauri::command]
async fn write_backup(json: String) -> Value {
    if json.len() > MAX_BACKUP_BYTES {
        return json!({ "ok": false, "error": "Invalid backup data." });
    }
    let result = blocking(move || -> std::io::Result<PathBuf> {
        let dir = backups_dir();
        std::fs::create_dir_all(&dir)?;
        let stamp = native::iso_stamp();
        let target = dir.join(format!("morrow-backup-{stamp}.json"));
        paths::write_atomic_plain(&target, json.as_bytes())?;
        let mut names: Vec<String> = std::fs::read_dir(&dir)?
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("morrow-backup-") && name.ends_with(".json"))
            .collect();
        names.sort();
        let extra = names.len().saturating_sub(KEEP_BACKUPS);
        for old in &names[..extra] {
            let _ = std::fs::remove_file(dir.join(old));
        }
        Ok(target)
    })
    .await;
    match result {
        Ok(Ok(path)) => json!({ "ok": true, "path": path.to_string_lossy() }),
        Ok(Err(error)) => json!({ "ok": false, "error": error.to_string() }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

// a reminder from the app, shown by the system
#[tauri::command]
fn notify<R: Runtime>(app: AppHandle<R>, title: String, body: String) {
    let title: String = title.chars().take(200).collect();
    let body: String = body.chars().take(500).collect();
    let _ = app.notification().builder().title(title).body(body).show();
}

// asks where to save, starting in documents with the name given
async fn ask_save_path<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    name: &str,
    filter: Option<(&str, &str)>,
) -> Option<PathBuf> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .set_directory(paths::documents_dir())
        .set_file_name(name);
    if let Some((label, extension)) = filter {
        dialog = dialog.add_filter(label, &[extension]);
    }
    #[cfg(desktop)]
    if let Some(window) = main_window(app) {
        dialog = dialog.set_parent(&window);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    dialog.save_file(move |path| {
        let _ = send.send(path.and_then(|path| path.into_path().ok()));
    });
    receive.await.ok().flatten()
}

// a file the interface made, such as an export or a backup, saved where the person picks
#[tauri::command]
async fn save_file<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Res<Value> {
    let name = header(&request, "name").unwrap_or_else(|| "Untitled".into());
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Invalid file data.".into());
    };
    let extension = Path::new(&name)
        .extension()
        .map(|ext| ext.to_string_lossy().into_owned());
    let filter = extension.as_deref().map(|ext| (ext, ext));
    let Some(path) = ask_save_path(&app, "Save", &name, filter).await else {
        return Ok(json!({ "ok": false, "error": null }));
    };
    let data = data.clone();
    let target = path.clone();
    match blocking(move || std::fs::write(&target, data)).await? {
        Ok(()) => Ok(json!({ "ok": true, "path": path.to_string_lossy() })),
        Err(error) => Ok(json!({ "ok": false, "error": error.to_string() })),
    }
}

// prints the page as it looks, with print styles hiding the rest of the app, and saves it where asked
#[tauri::command]
async fn export_pdf<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    name: String,
) -> Value {
    // without a way to print straight to a file, the system's print dialog saves it instead
    if !native::PRINTS_TO_FILE {
        #[cfg(desktop)]
        return match window.print() {
            Ok(()) => json!({ "ok": false, "error": null }),
            Err(error) => json!({ "ok": false, "error": error.to_string() }),
        };
        #[cfg(mobile)]
        return json!({ "ok": false, "error": "Saving as PDF is not available on this device yet." });
    }
    let base = paths::safe_file_name(&name, "Page");
    let Some(path) = ask_save_path(
        &app,
        "Export as PDF",
        &format!("{base}.pdf"),
        Some(("PDF", "pdf")),
    )
    .await
    else {
        return json!({ "ok": false, "error": null });
    };
    // paper is white whatever the theme
    let _ = window.set_background_color(Some(tauri::window::Color(255, 255, 255, 255)));
    let result = native::print_to_pdf(&window, &path).await;
    match result {
        Ok(()) => json!({ "ok": true, "path": path.to_string_lossy() }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

// a picture of part of the window, such as a whole canvas fitted into view, saved where the person picks
#[tauri::command]
async fn export_png<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    name: String,
    area: Value,
) -> Value {
    let numbers: Vec<f64> = ["x", "y", "width", "height"]
        .iter()
        .filter_map(|key| area[key].as_f64())
        .collect();
    if numbers.len() != 4 || numbers.iter().any(|value| !value.is_finite()) {
        return json!({ "ok": false, "error": "Nothing to save." });
    }
    let viewport = area["viewportWidth"].as_f64().unwrap_or(0.0);
    let png = match native::capture(
        &window,
        [numbers[0], numbers[1], numbers[2], numbers[3]],
        viewport,
    )
    .await
    {
        Ok(png) => png,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let base = paths::safe_file_name(&name, "Canvas");
    let Some(path) = ask_save_path(
        &app,
        "Save as image",
        &format!("{base}.png"),
        Some(("PNG", "png")),
    )
    .await
    else {
        return json!({ "ok": false, "error": null });
    };
    match std::fs::write(&path, png) {
        Ok(()) => json!({ "ok": true, "path": path.to_string_lossy() }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

// ---- the vault

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    let value = request.headers().get(name)?.to_str().ok()?;
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .ok()
        .map(|text| text.into_owned())
}

#[tauri::command]
async fn vault_state() -> Res<Value> {
    blocking(vault::state).await
}

#[cfg(desktop)]
#[tauri::command]
async fn vault_choose<R: Runtime>(app: AppHandle<R>, start: Option<String>) -> Option<String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose a folder for your notes")
        .set_directory(vault::chooser_start(start));
    if let Some(window) = main_window(&app) {
        dialog = dialog.set_parent(&window);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    dialog.pick_folder(move |path| {
        let _ = send.send(path.and_then(|path| path.into_path().ok()));
    });
    receive
        .await
        .ok()
        .flatten()
        .map(|path| path.to_string_lossy().into_owned())
}

// what another app shared with morrow on android, nothing anywhere else
#[cfg(target_os = "android")]
#[tauri::command]
async fn take_shared<R: Runtime>(app: AppHandle<R>) -> Value {
    let shared = device::take_shared(&app).await;
    json!({ "text": shared.text, "files": shared.files })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn take_shared() -> Value {
    json!({ "text": null, "files": [] })
}

// a file shared from another app, read once from where the phone copied it and then let go. only files in
// that one folder of morrow's cache can be read this way
#[tauri::command]
fn read_shared_file<R: Runtime>(app: AppHandle<R>, path: String) -> Res<Response> {
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("shared");
    let file = Path::new(&path);
    let inside = file.parent().is_some_and(|parent| {
        parent.canonicalize().ok() == folder.canonicalize().ok() && folder.exists()
    });
    if !inside || !file.is_file() {
        return Err("Not a shared file.".into());
    }
    let bytes = std::fs::read(file).map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(file);
    Ok(Response::new(bytes))
}

// on android a folder that is already on the phone can be opened, once morrow may read files outside its own
// storage. the person is asked for that here, the first time a folder is opened
#[cfg(target_os = "android")]
#[tauri::command]
async fn vault_choose<R: Runtime>(app: AppHandle<R>, start: Option<String>) -> Res<Option<String>> {
    let _ = start;
    if !device::storage_access(&app, true).await? {
        return Err("Morrow needs access to all files to open a folder on this phone.".into());
    }
    device::pick_folder(&app).await
}

#[cfg(all(mobile, not(target_os = "android")))]
#[tauri::command]
async fn vault_choose(_start: Option<String>) -> Option<String> {
    None
}

#[tauri::command]
async fn vault_cloud() -> Res<Value> {
    blocking(|| cloud::status(vault::current())).await
}

#[tauri::command]
async fn vault_copy_into(dir: String) -> Res<Value> {
    blocking(move || vault::copy_into(&dir)).await
}

#[tauri::command]
async fn vault_create_default<R: Runtime>(app: AppHandle<R>) -> Res<String> {
    // on a phone a new vault goes in its documents folder, where a file manager and a computer can reach it,
    // once morrow is allowed files outside its own storage. it asks, and keeps to its own storage if not
    #[cfg(target_os = "android")]
    if device::storage_access(&app, true).await.unwrap_or(false) {
        if let Some(documents) = device::documents_folder(&app).await {
            return blocking(move || vault::create_default_in(&documents)).await?;
        }
    }
    let _ = &app;
    blocking(vault::create_default).await?
}

#[tauri::command]
async fn vault_select(dir: String) -> Res<Value> {
    blocking(move || vault::select(&dir)).await
}

#[tauri::command]
async fn vault_forget(dir: String) -> Res<()> {
    blocking(move || vault::forget(&dir)).await?
}

#[tauri::command]
async fn vault_reorder(order: Vec<String>) -> Res<()> {
    blocking(move || vault::reorder(&order)).await?
}

#[tauri::command]
async fn vault_open<R: Runtime>(app: AppHandle<R>) -> Res<Value> {
    blocking(move || {
        let state = vault::state();
        let Some(current) = state["current"].as_str().map(String::from) else {
            return Ok(json!({ "ok": false, "root": null }));
        };
        let handle = app.clone();
        vault::open(&current, move |changes| {
            to_window(&handle, "vault:changes", changes)
        })?;
        Ok(json!({ "ok": true, "root": current }))
    })
    .await?
}

#[tauri::command]
fn vault_close() {
    vault::close();
}

#[tauri::command]
async fn vault_scan() -> Res<Value> {
    blocking(vault::scan).await?
}

#[tauri::command]
async fn vault_apply(ops: Value) -> Res<Vec<Value>> {
    blocking(move || vault::apply(ops)).await
}

#[tauri::command]
async fn vault_read_text(path: String) -> Res<Option<String>> {
    blocking(move || vault::read_text(&path)).await?
}

#[tauri::command]
async fn vault_read_bytes(path: String) -> Res<Response> {
    blocking(move || vault::read_bytes(&path))
        .await?
        .map(Response::new)
        .ok_or_else(|| "missing".into())
}

#[tauri::command]
async fn vault_create_file(request: Request<'_>) -> Res<()> {
    let path = header(&request, "path").ok_or("Invalid path.")?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Invalid file data.".into());
    };
    let data = data.clone();
    blocking(move || vault::create_file(&path, &data)).await?
}

#[tauri::command]
async fn vault_exists(path: String) -> Res<bool> {
    blocking(move || vault::path_exists(&path)).await?
}

#[tauri::command]
async fn vault_list(path: String) -> Res<Vec<Value>> {
    blocking(move || vault::list(&path)).await?
}

#[tauri::command]
async fn vault_reveal<R: Runtime>(app: AppHandle<R>, path: Option<String>) -> Res<()> {
    let target = match path.filter(|path| !path.is_empty()) {
        Some(path) => vault::resolve(&path)?,
        None => vault::current().ok_or("No vault is open.")?,
    };
    // a phone has no file manager to reveal a file in, the folder opens in the one it has
    #[cfg(target_os = "android")]
    return device::open_folder(&app, &target).await;
    #[cfg(not(target_os = "android"))]
    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn vault_open_file<R: Runtime>(app: AppHandle<R>, path: String) -> bool {
    if !vault::openable(&path) {
        return false;
    }
    let Some(absolute) = vault::file_path(&path) else {
        return false;
    };
    app.opener()
        .open_path(absolute.to_string_lossy(), None::<&str>)
        .is_ok()
}

#[tauri::command]
fn vault_open_link<R: Runtime>(app: AppHandle<R>, href: String, page_path: Option<String>) -> bool {
    match vault::local_link(&href, page_path.as_deref()) {
        Some(vault::LinkAction::Open(path)) => app
            .opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .is_ok(),
        Some(vault::LinkAction::Reveal(path)) => app.opener().reveal_item_in_dir(path).is_ok(),
        None => false,
    }
}

// puts a picture from the vault on the clipboard
#[tauri::command]
async fn vault_copy_image<R: Runtime>(app: AppHandle<R>, path: String) -> Res<bool> {
    if !vault::openable(&path) {
        return Ok(false);
    }
    let decoded = blocking(move || {
        let bytes = vault::read_bytes(&path)?;
        image::load_from_memory(&bytes)
            .ok()
            .map(|image| image.to_rgba8())
    })
    .await?;
    let Some(rgba) = decoded else {
        return Ok(false);
    };
    let (width, height) = rgba.dimensions();
    let image = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
    Ok(app.clipboard().write_image(&image).is_ok())
}

#[tauri::command]
async fn vault_manifest() -> Res<serde_json::Map<String, Value>> {
    blocking(vault::manifest).await?
}

#[tauri::command]
async fn vault_identity() -> Res<Value> {
    blocking(vault::identity).await?
}

#[tauri::command]
async fn vault_read_synced(path: String) -> Res<Option<String>> {
    blocking(move || vault::synced_file_base64(&path)).await
}

#[tauri::command]
async fn vault_write_synced(path: String, data: String, expect: Option<String>) -> Res<Value> {
    blocking(move || vault::write_synced(&path, &data, expect)).await?
}

#[tauri::command]
async fn vault_prepare_copy(dir: String, vault_id: String) -> Res<Value> {
    blocking(move || vault::prepare_copy(&dir, &vault_id)).await
}

#[tauri::command]
async fn vault_sync_base(peer_id: String) -> Res<Value> {
    blocking(move || vault::read_sync_base(&peer_id)).await
}

#[tauri::command]
async fn vault_save_sync_base(peer_id: String, files: Value) -> Res<()> {
    blocking(move || vault::write_sync_base(&peer_id, files)).await?
}

// ---- sync

#[tauri::command]
async fn sync_status() -> Res<Value> {
    blocking(sync::status).await
}

#[tauri::command]
async fn sync_enable<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Res<()> {
    if enabled {
        allow_local_network(&app).await;
    }
    blocking(move || sync::set_enabled(enabled)).await
}

// a phone asks to reach the other devices on its network before syncing with them
#[allow(unused_variables)]
async fn allow_local_network<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "android")]
    sync::LOCAL_NETWORK_ALLOWED.store(device::local_network(app, true).await, Ordering::Relaxed);
}

#[tauri::command]
async fn sync_name(name: String) -> Res<()> {
    blocking(move || sync::set_name(&name)).await
}

#[tauri::command]
async fn sync_start_pairing<R: Runtime>(app: AppHandle<R>) -> Res<String> {
    allow_local_network(&app).await;
    blocking(sync::start_pairing).await
}

#[tauri::command]
async fn sync_stop_pairing() -> Res<()> {
    blocking(sync::stop_pairing).await
}

#[tauri::command]
async fn sync_pair<R: Runtime>(app: AppHandle<R>, target: Value, code: String) -> Value {
    allow_local_network(&app).await;
    sync::pair(target, code).await
}

#[tauri::command]
async fn sync_forget(id: String) -> Res<()> {
    blocking(move || sync::forget(&id)).await
}

#[tauri::command]
async fn sync_request(peer_id: String, payload: Value) -> Res<Value> {
    sync::request(peer_id, payload).await
}

#[tauri::command]
async fn sync_mark(peer_id: String) -> Res<()> {
    blocking(move || sync::mark(&peer_id)).await
}

// ---- updates, the assistant and mcp

#[tauri::command]
async fn update_check() -> Value {
    match updates::check().await {
        Ok(update) => json!({ "ok": true, "update": update }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[tauri::command]
async fn update_install<R: Runtime>(app: AppHandle<R>) -> Value {
    let handle = app.clone();
    match updates::install(&app, move |share| {
        to_window(&handle, "update:progress", share)
    })
    .await
    {
        Ok(()) => json!({ "ok": true }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[tauri::command]
async fn ai_settings() -> Res<Value> {
    blocking(ai::settings).await
}

#[tauri::command]
async fn ai_configure(patch: Value) -> Res<Value> {
    blocking(move || ai::configure(patch)).await?
}

#[tauri::command]
async fn ai_models() -> Value {
    ai::models().await
}

#[tauri::command]
async fn ai_turn(request: Value) -> Value {
    ai::turn(request).await
}

#[tauri::command]
fn ai_cancel(id: String) {
    ai::cancel(&id);
}

#[tauri::command]
fn mcp_launch<R: Runtime>(app: AppHandle<R>) -> Value {
    mcp::launch(&app)
}

#[tauri::command]
fn mcp_set_enabled(enabled: bool) -> bool {
    mcp::set_enabled(enabled)
}

#[tauri::command]
fn mcp_is_enabled() -> bool {
    mcp::is_enabled()
}

// ---- files in the vault and on the computer, for pictures, sound and video in pages

fn not_found() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(404)
        .body(b"Not found".to_vec())
        .expect("valid response")
}

// pictures, sound and video a page links to elsewhere on the computer play from where they are, without a
// copy in the vault. only those kinds of file are ever served this way
fn local_media_path(value: &str) -> Option<PathBuf> {
    // the address drops the leading slash, a windows path keeps its drive, C:/folder/file
    let bytes = value.as_bytes();
    let windows_drive =
        bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
    let file = if windows_drive {
        PathBuf::from(value)
    } else {
        PathBuf::from(format!("/{value}"))
    };
    let extension = file.extension()?.to_string_lossy().to_ascii_lowercase();
    let media = [
        "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "mp3", "m4a", "wav", "ogg",
        "oga", "flac", "aac", "opus", "weba", "mp4", "m4v", "webm", "mov", "ogv",
    ];
    (file.is_absolute() && media.contains(&extension.as_str())).then(|| paths::normalize(&file))
}

// addresses look like morrow-file://localhost/vault/<path> or /local/<path>. windows has no custom schemes in
// its webview, there they arrive as http://morrow-file.localhost/vault/<path>
fn serve_file(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let raw_path = request.uri().path().trim_start_matches('/');
    let Some((kind, rest)) = raw_path.split_once('/') else {
        return not_found();
    };
    let Ok(relative) = percent_encoding::percent_decode_str(rest).decode_utf8() else {
        return not_found();
    };
    let file = match kind {
        "vault" => vault::file_path(&relative),
        "local" => local_media_path(&relative),
        _ => None,
    };
    let Some(file) = file.filter(|file| file.is_file()) else {
        return not_found();
    };
    let Ok(info) = std::fs::metadata(&file) else {
        return not_found();
    };
    if info.len() > vault::MAX_FILE_BYTES {
        return not_found();
    }
    let size = info.len();
    let mime = mime_guess::from_path(&file)
        .first_or_octet_stream()
        .to_string();
    let mut builder = tauri::http::Response::builder()
        .header("Content-Type", &mime)
        .header("Accept-Ranges", "bytes")
        .header("X-Content-Type-Options", "nosniff")
        .header("Access-Control-Allow-Origin", "*");
    // svg images can carry scripts, they are only ever shown as images, pdfs open in the built in viewer
    if mime != "application/pdf" {
        builder = builder.header(
            "Content-Security-Policy",
            "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        );
    }
    // sound and video ask for a part at a time, so long files start at once and can be skipped through
    let range = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes="))
        .and_then(|value| {
            let (start, end) = value.split_once('-')?;
            let start: u64 = start.parse().ok()?;
            let end: u64 = if end.is_empty() {
                (start + 4 * 1024 * 1024).min(size) - 1
            } else {
                end.parse().ok()?
            };
            (start <= end && end < size).then_some((start, end))
        });
    if let Some((start, end)) = range {
        use std::io::{Read, Seek, SeekFrom};
        let mut data = vec![0u8; (end - start + 1) as usize];
        let read = std::fs::File::open(&file).and_then(|mut handle| {
            handle
                .seek(SeekFrom::Start(start))
                .and_then(|_| handle.read_exact(&mut data))
        });
        if read.is_err() {
            return not_found();
        }
        return builder
            .status(206)
            .header("Content-Range", format!("bytes {start}-{end}/{size}"))
            .header("Content-Length", data.len().to_string())
            .body(data)
            .unwrap_or_else(|_| not_found());
    }
    match std::fs::read(&file) {
        Ok(data) => builder
            .status(200)
            .body(data)
            .unwrap_or_else(|_| not_found()),
        Err(_) => not_found(),
    }
}

// ---- the window

fn info_script() -> String {
    let info = json!({
        "version": env!("CARGO_PKG_VERSION"),
        "dataPath": paths::data_dir().to_string_lossy(),
        "platform": platform(),
        "capturesWindow": native::CAPTURES,
    });
    format!("Object.defineProperty(window, '__MORROW_INFO__', {{ value: Object.freeze({info}) }});")
}

fn create_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let handle = app.clone();
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Morrow")
        .inner_size(1280.0, 820.0)
        .min_inner_size(520.0, 420.0)
        .visible(false)
        .initialization_script(info_script())
        .disable_drag_drop_handler()
        // links to the web open in the browser, the window only ever shows morrow itself. the web view also
        // asks here for the frames of websites shown in a page, those the page asked for are let through
        .on_navigation(move |url| {
            let internal = matches!(url.scheme(), "tauri" | "morrow-file")
                || url
                    .host_str()
                    .is_some_and(|host| host.ends_with(".localhost") || host == "localhost");
            if !internal && framed(url.as_str()) {
                return true;
            }
            if !internal && is_web_url(url.as_str()) {
                let _ = handle.opener().open_url(url.as_str(), None::<&str>);
            }
            internal
        });
    #[cfg(desktop)]
    let builder = builder.decorations(cfg!(target_os = "macos"));
    #[cfg(windows)]
    let builder = builder.additional_browser_args(&native::browser_args());
    #[cfg(windows)]
    if let Ok(profile) = app.path().app_local_data_dir() {
        native::prepare_spelling(&profile);
    }
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 21.0));
    let window = builder.build()?;
    let dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    let _ = window.set_background_color(Some(if dark { DARK } else { LIGHT }));
    native::setup_webview(&window);
    // the window shows at once in the colour of the app rather than after the page's first paint, so opening
    // morrow never looks like nothing happened
    if !(cfg!(debug_assertions) && std::env::var("MORROW_HIDDEN").as_deref() == Ok("1")) {
        // started with the computer and asked to stay out of the way, it waits in the taskbar
        #[cfg(desktop)]
        if background::launched_at_login() && background::read().start_minimized {
            let _ = window.minimize();
        }
        window.show()?;
    }
    let closing = app.clone();
    window.on_window_event(move |event| {
        // the interface writes pending edits and a backup before the window closes, for five seconds at most
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if READY_TO_CLOSE.load(Ordering::SeqCst) {
                vault::close();
                return;
            }
            api.prevent_close();
            command(&closing, "app.prepareToClose");
            let later = closing.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                READY_TO_CLOSE.store(true, Ordering::SeqCst);
                if let Some(window) = main_window(&later) {
                    let _ = window.close();
                }
            });
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                bring_forward(app)
            }))
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::all()
                            - tauri_plugin_window_state::StateFlags::VISIBLE,
                    )
                    .with_denylist(&["capture"])
                    .build(),
            );
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol(FILE_SCHEME, |_context, request, responder| {
            std::thread::spawn(move || responder.respond(serve_file(&request)));
        })
        .setup(|app| {
            paths::init_data_dir(app.path().app_config_dir().ok());
            // a phone keeps vaults in the app's own storage, synced with a computer over the network
            #[cfg(mobile)]
            paths::set_documents_dir(app.path().app_data_dir().ok().map(|dir| dir.join("Vaults")));
            #[cfg(target_os = "android")]
            {
                app.handle().plugin(device::init())?;
                // a phone calls itself localhost, its own name is what the other computer should show
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(name) = device::name(&handle).await {
                        sync::set_default_name(&name);
                    }
                    // sync turned on before android asked about the local network asks now
                    if sync::status()["enabled"].as_bool() == Some(true) {
                        allow_local_network(&handle).await;
                    }
                });
            }
            let handle = app.handle().clone();
            sync::init(move |event| to_window(&handle, "sync:event", event));
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                // quick capture from any app: a small box for a note comes up over whatever is open, the main
                // window stays where it is
                let shortcuts = tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            // made off the event loop, which the new window needs free
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move { open_capture(&app) });
                        }
                    })
                    .build();
                app.handle().plugin(shortcuts)?;
                if background::read().quick_capture {
                    let _ = app.global_shortcut().register(background::CAPTURE_SHORTCUT);
                }
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    Some(vec![background::AUTOSTART_ARG]),
                ))?;
            }
            create_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            close_ready,
            set_theme,
            set_zoom,
            spell_languages,
            set_spell_languages,
            spell_check,
            spell_suggest,
            spell_add,
            open_external,
            copy_text,
            copy_rich,
            clipboard_files,
            read_clipboard_file,
            read_pasted_picture,
            fetch_calendar,
            fetch_image,
            fetch_page_head,
            allow_frame,
            capture_submit,
            capture_open,
            capture_hide,
            background_settings,
            set_background_settings,
            show_data_folder,
            show_backups,
            write_backup,
            notify,
            save_file,
            export_pdf,
            export_png,
            vault_state,
            vault_choose,
            vault_cloud,
            vault_copy_into,
            vault_create_default,
            vault_select,
            vault_forget,
            vault_reorder,
            take_shared,
            read_shared_file,
            vault_open,
            vault_close,
            vault_scan,
            vault_apply,
            vault_read_text,
            vault_read_bytes,
            vault_create_file,
            vault_exists,
            vault_list,
            vault_reveal,
            vault_open_file,
            vault_open_link,
            vault_copy_image,
            vault_manifest,
            vault_identity,
            vault_read_synced,
            vault_write_synced,
            vault_prepare_copy,
            vault_sync_base,
            vault_save_sync_base,
            sync_status,
            sync_enable,
            sync_name,
            sync_start_pairing,
            sync_stop_pairing,
            sync_pair,
            sync_forget,
            sync_request,
            sync_mark,
            update_check,
            update_install,
            ai_settings,
            ai_configure,
            ai_models,
            ai_turn,
            ai_cancel,
            mcp_launch,
            mcp_set_enabled,
            mcp_is_enabled,
        ])
        .build(tauri::generate_context!())
        .expect("Morrow could not start")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                sync::close();
                vault::close();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_local_media_in_parts() {
        let dir = std::env::temp_dir().join(format!("morrow-serve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, (0u8..=255).collect::<Vec<_>>()).unwrap();
        // the way the interface writes a path into an address: forward slashes on every system, C:/folder
        // on windows, and no slash at the start
        let address = |file: &Path| {
            file.to_string_lossy()
                .replace('\\', "/")
                .trim_start_matches('/')
                .to_string()
        };
        let path = address(&file);
        let request = |range: Option<&str>| {
            let mut builder = tauri::http::Request::builder()
                .uri(format!("morrow-file://localhost/local/{path}"));
            if let Some(range) = range {
                builder = builder.header("range", range);
            }
            serve_file(&builder.body(Vec::new()).unwrap())
        };
        let whole = request(None);
        assert_eq!(whole.status(), 200);
        assert_eq!(whole.body().len(), 256);
        assert_eq!(whole.headers()["content-type"], "video/mp4");
        let part = request(Some("bytes=10-19"));
        assert_eq!(part.status(), 206);
        assert_eq!(part.body(), &(10u8..20).collect::<Vec<_>>());
        assert_eq!(part.headers()["content-range"], "bytes 10-19/256");
        let open_ended = request(Some("bytes=250-"));
        assert_eq!(open_ended.body().len(), 6);
        // only media is served from outside the vault
        let text = dir.join("secret.txt");
        std::fs::write(&text, "no").unwrap();
        let other = tauri::http::Request::builder()
            .uri(format!("morrow-file://localhost/local/{}", address(&text)))
            .body(Vec::new())
            .unwrap();
        assert_eq!(serve_file(&other).status(), 404);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
