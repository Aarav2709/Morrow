// what only android can answer, asked through the small kotlin plugin in gen/android: reading folders outside
// the app's own storage, picking one, the phone's name and the colour behind the status bar
use serde::Deserialize;
use serde_json::json;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

struct Device<R: Runtime>(PluginHandle<R>);

#[derive(Deserialize)]
struct Access {
    #[serde(default)]
    granted: bool,
}

#[derive(Deserialize)]
struct Picked {
    path: Option<String>,
    #[serde(default)]
    unsupported: bool,
}

#[derive(Deserialize)]
struct Named {
    name: Option<String>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("morrow-device")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.morrow", "DevicePlugin")?;
            app.manage(Device(handle));
            Ok(())
        })
        .build()
}

async fn call<R: Runtime, T: serde::de::DeserializeOwned>(
    app: &AppHandle<R>,
    command: &str,
    payload: serde_json::Value,
) -> Result<T, String> {
    let device = app
        .try_state::<Device<R>>()
        .ok_or("This is not available on this phone.")?;
    device
        .0
        .run_mobile_plugin_async(command, payload)
        .await
        .map_err(|error| error.to_string())
}

// whether folders outside the app can be read, asking the person first when `request` is set
pub async fn storage_access<R: Runtime>(app: &AppHandle<R>, request: bool) -> Result<bool, String> {
    let command = if request {
        "requestStorageAccess"
    } else {
        "storageAccess"
    };
    let access: Access = call(app, command, json!({})).await?;
    Ok(access.granted)
}

pub async fn pick_folder<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    let picked: Picked = call(app, "pickFolder", json!({})).await?;
    if picked.unsupported {
        return Err("Morrow can only open folders kept on the phone itself or its SD card.".into());
    }
    Ok(picked.path)
}

#[derive(Deserialize, serde::Serialize, Default)]
pub struct Shared {
    pub text: Option<String>,
    // files copied into morrow's cache from the app that shared them
    #[serde(default)]
    pub files: Vec<String>,
}

// a link, words or files another app shared with morrow, once
pub async fn take_shared<R: Runtime>(app: &AppHandle<R>) -> Shared {
    let mut shared: Shared = call(app, "takeShared", json!({})).await.unwrap_or_default();
    shared.text = shared.text.filter(|text| !text.trim().is_empty());
    shared
}

pub async fn name<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let named: Named = call(app, "deviceName", json!({})).await.ok()?;
    named.name.filter(|name| !name.trim().is_empty())
}

pub fn set_theme<R: Runtime>(app: &AppHandle<R>, dark: bool, color: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _: Result<serde_json::Value, _> =
            call(&app, "setTheme", json!({ "dark": dark, "color": color })).await;
    });
}

// whether morrow may reach other devices on the network, asking first when `request` is set. android 17
// keeps an app away from them until this is allowed, which made pairing fail both ways
pub async fn local_network<R: Runtime>(app: &AppHandle<R>, request: bool) -> bool {
    let command = if request {
        "requestLocalNetworkAccess"
    } else {
        "localNetworkAccess"
    };
    call::<R, Access>(app, command, json!({}))
        .await
        .map(|access| access.granted)
        .unwrap_or(true)
}

#[derive(Deserialize)]
struct Opened {
    #[serde(default)]
    opened: bool,
    #[serde(default)]
    private: bool,
}

// a folder on the phone shown in its file manager, the way show in folder does on a computer
pub async fn open_folder<R: Runtime>(
    app: &AppHandle<R>,
    path: &std::path::Path,
) -> Result<(), String> {
    let opened: Opened = call(app, "openFolder", json!({ "path": path.to_string_lossy() })).await?;
    if opened.private {
        return Err(
            "This vault is kept in Morrow's own storage on the phone, which other apps can't open. Move it \
             to a folder on the phone from Settings, Vault, to see its files."
                .into(),
        );
    }
    if !opened.opened {
        return Err(format!(
            "No app on this phone opens folders. The vault is in {}.",
            path.to_string_lossy()
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
struct Folder {
    path: Option<String>,
}

// the phone's documents folder, which a file manager and a computer over usb can both reach
pub async fn documents_folder<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    let folder: Folder = call(app, "documentsFolder", json!({})).await.ok()?;
    folder.path.map(std::path::PathBuf::from)
}
