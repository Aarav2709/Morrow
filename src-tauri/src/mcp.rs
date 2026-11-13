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
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("dist-mcp")
            .join("index.js");
        dev.exists().then(|| paths::normalize(&dev))
    })
}

// node on this computer. an app opened from the dock or start menu doesn't get the shell's path, so the
// places node is usually put by homebrew, the installer, nvm, volta and fnm are looked through as well. the
// server runs with node itself, never morrow, so starting it doesn't bring morrow up on screen
fn find_node() -> Option<PathBuf> {
    if let Ok(found) = which::which("node") {
        return Some(found);
    }
    let home = paths::home_dir();
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let mut places: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        home.join(".volta/bin"),
        home.join(".local/bin"),
        PathBuf::from(r"C:\Program Files\nodejs"),
    ];
    // the newest node an nvm or fnm install holds
    for root in [
        home.join(".nvm/versions/node"),
        home.join(".local/share/fnm/node-versions"),
    ] {
        if let Ok(entries) = std::fs::read_dir(&root) {
            let mut versions: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
            versions.sort();
            for version in versions.into_iter().rev() {
                places.push(version.join("bin"));
                places.push(version.join("installation/bin"));
            }
        }
    }
    places
        .into_iter()
        .map(|dir| dir.join(exe))
        .find(|path| path.is_file())
}

// how an app such as claude desktop starts morrow's server. an appimage mounts into a new temporary folder
// every run, and an installed app can move, so the script is copied into morrow's own folder, written as
// .mjs because it is an es module
pub fn launch<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Value {
    let node = find_node();
    let command = node
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "node".into());
    let Some(bundled) = bundled_script(app) else {
        return json!({ "command": command, "script": "", "available": false });
    };
    let script = paths::data_dir().join("mcp-server.mjs");
    let copied = std::fs::read(&bundled).ok().is_some_and(|source| {
        std::fs::read(&script).ok().as_deref() == Some(&source[..])
            || std::fs::write(&script, &source).is_ok()
    });
    let script = if copied { script } else { bundled };
    json!({ "command": command, "script": script.to_string_lossy(), "available": node.is_some() })
}
