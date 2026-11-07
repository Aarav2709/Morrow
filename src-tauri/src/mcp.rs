// morrow's mcp server lets other ai apps read and write the vault. it is a node script bundled with the app,
// run by the node on this computer
use crate::paths;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::Manager;

fn config_file() -> PathBuf {
    paths::data_dir().join("mcp.json")
}

pub fn is_enabled() -> bool {
    paths::read_json(&config_file()).and_then(|raw| raw["enabled"].as_bool()) == Some(true)
}

pub fn set_enabled(enabled: bool) -> bool {
    let body = serde_json::to_vec_pretty(&json!({ "enabled": enabled })).unwrap_or_default();
    paths::write_atomic_plain(&config_file(), &body).is_ok() && enabled
}

fn bundled_script<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    let resource = app
        .path()
        .resolve("mcp/index.js", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.exists());
    // a development run uses the copy the build just made
    resource.or_else(|| {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist-mcp").join("index.js");
        dev.exists().then(|| paths::normalize(&dev))
    })
}

// how an app such as claude desktop starts morrow's server. an appimage mounts into a new temporary folder
// every run, and an installed app can move, so the script is copied into morrow's own folder, written as
// .mjs because it is an es module
pub fn launch<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Value {
    let node = which::which("node").ok();
    let command = node
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "node".into());
    let Some(bundled) = bundled_script(app) else {
        return json!({ "command": command, "script": "", "available": false });
    };
    let script = paths::data_dir().join("mcp-server.mjs");
    let copied = std::fs::read(&bundled).ok().is_some_and(|source| {
        std::fs::read(&script).ok().as_deref() == Some(&source[..]) || std::fs::write(&script, &source).is_ok()
    });
    let script = if copied { script } else { bundled };
    json!({ "command": command, "script": script.to_string_lossy(), "available": node.is_some() })
}
