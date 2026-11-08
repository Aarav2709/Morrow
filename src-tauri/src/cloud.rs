// finds the folders cloud apps keep in sync, so a vault can live in one and follow you between computers.
// morrow never talks to these services, the vault is just a folder their own apps copy around
use crate::paths;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn is_dir(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|info| info.is_dir())
        .unwrap_or(false)
}

// dropbox writes where its folders are, one per account, in an info.json of its own
fn dropbox_folders(home: &Path) -> Vec<PathBuf> {
    let mut files = vec![home.join(".dropbox").join("info.json")];
    if cfg!(windows) {
        for variable in ["APPDATA", "LOCALAPPDATA"] {
            if let Some(dir) = std::env::var_os(variable) {
                files.push(PathBuf::from(dir).join("Dropbox").join("info.json"));
            }
        }
    }
    let mut found = Vec::new();
    for file in files {
        if let Some(Value::Object(accounts)) = paths::read_json(&file) {
            for account in accounts.values() {
                if let Some(path) = account["path"]
                    .as_str()
                    .map(PathBuf::from)
                    .filter(|p| p.is_absolute())
                {
                    found.push(path);
                }
            }
        }
    }
    found
}

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(target_os = "linux") {
        a == b
    } else {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    }
}

pub fn folders() -> Vec<(String, PathBuf)> {
    let home = paths::home_dir();
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    for dir in dropbox_folders(&home) {
        candidates.push(("Dropbox".into(), dir));
    }
    if cfg!(target_os = "macos") {
        candidates.push((
            "iCloud Drive".into(),
            home.join("Library")
                .join("Mobile Documents")
                .join("com~apple~CloudDocs"),
        ));
        // apps built on apple's file provider all keep their folder here, named after the app and the account
        let storage = home.join("Library").join("CloudStorage");
        if let Ok(entries) = std::fs::read_dir(&storage) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let provider = if name.starts_with("GoogleDrive") {
                    "Google Drive".to_string()
                } else if name.starts_with("OneDrive") {
                    "OneDrive".to_string()
                } else {
                    name.split('-').next().unwrap_or(&name).to_string()
                };
                let dir = storage.join(&name);
                // google drive keeps your own files in My Drive, the rest of the account folder is shared drives
                let mine = dir.join("My Drive");
                candidates.push((provider, if is_dir(&mine) { mine } else { dir }));
            }
        }
    }
    if cfg!(windows) {
        for variable in ["OneDriveConsumer", "OneDriveCommercial", "OneDrive"] {
            if let Some(dir) = std::env::var_os(variable) {
                candidates.push(("OneDrive".into(), PathBuf::from(dir)));
            }
        }
        candidates.push(("iCloud Drive".into(), home.join("iCloudDrive")));
        // google drive for desktop shows up as a drive of its own, G: unless that letter was taken
        for letter in "GHIJKLMNOPQRSTUVWXYZDEF".chars() {
            candidates.push((
                "Google Drive".into(),
                PathBuf::from(format!("{letter}:\\My Drive")),
            ));
        }
    }
    for (provider, name) in [
        ("Dropbox", "Dropbox"),
        ("OneDrive", "OneDrive"),
        ("Google Drive", "Google Drive"),
        ("Nextcloud", "Nextcloud"),
        ("ownCloud", "ownCloud"),
        ("Syncthing", "Sync"),
        ("pCloud", "pCloudDrive"),
        ("MEGA", "MEGA"),
        ("Box", "Box"),
        ("Proton Drive", "Proton Drive"),
    ] {
        candidates.push((provider.into(), home.join(name)));
    }
    let mut found: Vec<(String, PathBuf)> = Vec::new();
    for (provider, path) in candidates {
        let path = paths::normalize(&path);
        if found.iter().any(|(_, item)| same_path(item, &path)) {
            continue;
        }
        if is_dir(&path) {
            found.push((provider, path));
        }
    }
    found
}

// where the open vault is, among the cloud folders, if it is in one
pub fn status(current: Option<PathBuf>) -> Value {
    let folders = folders();
    let fold = |path: &Path| {
        if cfg!(target_os = "linux") {
            path.to_path_buf()
        } else {
            PathBuf::from(path.to_string_lossy().to_lowercase())
        }
    };
    let inside = current.and_then(|current| {
        folders
            .iter()
            .find(|(_, path)| paths::is_inside(&fold(&current), &fold(path)))
            .map(|(provider, path)| json!({ "provider": provider, "path": path.to_string_lossy() }))
    });
    let list: Vec<Value> = folders
        .iter()
        .map(|(provider, path)| json!({ "provider": provider, "path": path.to_string_lossy() }))
        .collect();
    json!({ "folders": list, "inside": inside })
}
