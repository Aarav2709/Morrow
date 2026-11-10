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

pub async fn name<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let named: Named = call(app, "deviceName", json!({})).await.ok()?;
    named.name.filter(|name| !name.trim().is_empty())
}

pub fn set_theme<R: Runtime>(app: &AppHandle<R>, dark: bool, color: &'static str) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _: Result<serde_json::Value, _> =
            call(&app, "setTheme", json!({ "dark": dark, "color": color })).await;
    });
}
