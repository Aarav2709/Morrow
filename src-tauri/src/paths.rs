// where morrow keeps its own files: the same folder the electron versions used, so the list of vaults, sync
// pairings and the assistant's settings carry over from 1.x
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static DOCUMENTS_DIR: OnceLock<PathBuf> = OnceLock::new();

// where new vaults go when the system has no documents folder of its own, as on a phone
#[allow(dead_code)]
pub fn set_documents_dir(dir: Option<PathBuf>) {
    if let Some(dir) = dir {
        let _ = std::fs::create_dir_all(&dir);
        let _ = DOCUMENTS_DIR.set(dir);
    }
}

pub fn init_data_dir(fallback: Option<PathBuf>) {
    let dir = (cfg!(debug_assertions))
        .then(|| std::env::var_os("MORROW_USER_DATA").map(PathBuf::from))
        .flatten()
        // a phone has no home folder an app may write to, only the place the system gives the app
        .or_else(|| if cfg!(mobile) { fallback.clone() } else { None })
        .or_else(|| dirs::config_dir().map(|dir| dir.join("Morrow")))
        .or(fallback)
        .unwrap_or_else(|| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    let _ = DATA_DIR.set(dir);
}

pub fn data_dir() -> PathBuf {
    DATA_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn documents_dir() -> PathBuf {
    DOCUMENTS_DIR
        .get()
        .cloned()
        .or_else(dirs::document_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

// resolves . and .. without touching the disk, like node's path.resolve
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                if !out.pop() {
                    out.push(part);
                }
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

pub fn is_inside(dir: &Path, parent: &Path) -> bool {
    let dir = normalize(dir);
    let parent = normalize(parent);
    dir == parent || dir.starts_with(&parent)
}

// writes beside the target first, so a crash never leaves half a file
pub fn write_atomic_plain(target: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = target.with_file_name(format!(
        "{}.tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
    ));
    std::fs::write(&temp, data)?;
    std::fs::rename(&temp, target)
}

pub fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

pub fn millis(time: std::io::Result<std::time::SystemTime>) -> f64 {
    time.ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

// a name safe to save as a file on every system
pub fn safe_file_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = trimmed.chars().take(120).collect();
    if short.is_empty() {
        fallback.to_string()
    } else {
        short
    }
}
