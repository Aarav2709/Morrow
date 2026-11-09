// file system access for the vault, every path is checked to stay inside the chosen folder
use crate::paths::{self, millis, normalize};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

const MAX_FILES: usize = 200_000;
const MAX_DEPTH: usize = 64;
const MAX_TEXT_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const TEMP_MARK: &str = ".morrow-tmp-";

struct Open {
    root: PathBuf,
    real_root: PathBuf,
    _watcher: Option<notify::RecommendedWatcher>,
}

static OPEN: Mutex<Option<Open>> = Mutex::new(None);
// size, modified time and hash of each file, so an unchanged file is not read again
type HashCache = HashMap<PathBuf, (u64, f64, String)>;
static HASHES: Mutex<Option<HashCache>> = Mutex::new(None);

pub type Result<T> = std::result::Result<T, String>;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn list_file() -> PathBuf {
    paths::data_dir().join("vaults.json")
}

#[derive(Default)]
struct VaultList {
    current: Option<String>,
    recent: Vec<(String, f64)>,
}

fn read_list() -> VaultList {
    let Some(raw) = paths::read_json(&list_file()) else {
        return VaultList::default();
    };
    let current = raw["current"]
        .as_str()
        .filter(|path| Path::new(path).is_absolute())
        .map(String::from);
    let recent = raw["recent"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let path = item["path"].as_str()?;
                    Path::new(path)
                        .is_absolute()
                        .then(|| (path.to_string(), item["openedAt"].as_f64().unwrap_or(0.0)))
                })
                .take(20)
                .collect()
        })
        .unwrap_or_default();
    VaultList { current, recent }
}

fn write_list(list: &VaultList) -> Result<()> {
    let recent: Vec<Value> = list
        .recent
        .iter()
        .map(|(path, at)| json!({ "path": path, "openedAt": at }))
        .collect();
    let body = serde_json::to_vec_pretty(&json!({ "current": list.current, "recent": recent }))
        .map_err(err)?;
    paths::write_atomic_plain(&list_file(), &body).map_err(err)
}

fn is_dir(path: &Path) -> bool {
    fs::metadata(path)
        .map(|info| info.is_dir())
        .unwrap_or(false)
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn state() -> Value {
    let list = read_list();
    let recent: Vec<Value> = list
        .recent
        .iter()
        .map(|(path, _)| {
            json!({ "path": path, "name": base_name(Path::new(path)), "exists": is_dir(Path::new(path)) })
        })
        .collect();
    let current = list.current.filter(|path| is_dir(Path::new(path)));
    json!({ "current": current, "recent": recent })
}

pub fn select(dir: &str) -> Value {
    let path = Path::new(dir);
    if !path.is_absolute() {
        return json!({ "ok": false, "error": "Choose a folder." });
    }
    let resolved = normalize(path);
    if !is_dir(&resolved) {
        return json!({ "ok": false, "error": "That folder does not exist any more." });
    }
    if resolved.parent().is_none() || resolved == paths::home_dir() {
        return json!({
            "ok": false,
            "error": "Choose a folder of its own for your notes, not your whole drive or home folder."
        });
    }
    let text = resolved.to_string_lossy().into_owned();
    let mut list = read_list();
    list.current = Some(text.clone());
    list.recent.retain(|(path, _)| *path != text);
    list.recent.insert(0, (text, paths::now_ms() as f64));
    list.recent.truncate(20);
    match write_list(&list) {
        Ok(()) => json!({ "ok": true }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

pub fn forget(dir: &str) -> Result<()> {
    let mut list = read_list();
    list.recent.retain(|(path, _)| path != dir);
    if list.current.as_deref() == Some(dir) {
        list.current = None;
    }
    write_list(&list)
}

pub fn create_default() -> Result<String> {
    let documents = paths::documents_dir();
    let mut candidate = documents.join("Morrow");
    let mut n = 2;
    while exists(&candidate) {
        candidate = documents.join(format!("Morrow {n}"));
        n += 1;
    }
    fs::create_dir_all(&candidate).map_err(err)?;
    Ok(candidate.to_string_lossy().into_owned())
}

pub fn chooser_start(start: Option<String>) -> PathBuf {
    start
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && is_dir(path))
        .unwrap_or_else(paths::documents_dir)
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_symlink() {
            let link = fs::read_link(entry.path())?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(link, &target)?;
            #[cfg(windows)]
            {
                let _ = link;
            }
        } else if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

// copies the open vault, history and all, into another folder such as a cloud app's, and returns the copy
pub fn copy_into(parent: &str) -> Value {
    let Some(root) = current() else {
        return json!({ "ok": false, "error": "No vault is open." });
    };
    let into = Path::new(parent);
    if !into.is_absolute() || !is_dir(into) {
        return json!({ "ok": false, "error": "That folder does not exist." });
    }
    let into = normalize(into);
    if paths::is_inside(&into, &root) {
        return json!({ "ok": false, "error": "Choose a folder outside this vault." });
    }
    let name = base_name(&root);
    let mut target = into.join(&name);
    let mut n = 2;
    while exists(&target) {
        target = into.join(format!("{name} {n}"));
        n += 1;
    }
    if let Err(error) = copy_tree(&root, &target) {
        let _ = fs::remove_dir_all(&target);
        return json!({ "ok": false, "error": format!("The vault could not be copied: {error}") });
    }
    json!({ "ok": true, "path": target.to_string_lossy() })
}

pub fn current() -> Option<PathBuf> {
    OPEN.lock().ok()?.as_ref().map(|open| open.root.clone())
}

fn roots() -> Result<(PathBuf, PathBuf)> {
    let guard = OPEN.lock().map_err(err)?;
    let open = guard.as_ref().ok_or("No vault is open.")?;
    Ok((open.root.clone(), open.real_root.clone()))
}

pub fn open(dir: &str, on_changes: impl Fn(Vec<Value>) + Send + 'static) -> Result<()> {
    close();
    let root = normalize(Path::new(dir));
    let real_root = dunce::canonicalize(&root).map_err(err)?;
    let watcher = start_watching(&root, on_changes);
    *OPEN.lock().map_err(err)? = Some(Open {
        root,
        real_root,
        _watcher: watcher,
    });
    Ok(())
}

pub fn close() {
    if let Ok(mut open) = OPEN.lock() {
        *open = None;
    }
}

// a vault relative path to an absolute one, refusing anything that would leave the vault
pub fn resolve(relative: &str) -> Result<PathBuf> {
    let (root, _) = roots()?;
    resolve_in(&root, relative)
}

fn resolve_in(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.is_empty()
        || relative.len() > 4096
        || relative.contains('\0')
        || relative.contains('\\')
    {
        return Err("Invalid path.".into());
    }
    let candidate = Path::new(relative);
    if candidate.is_absolute() || candidate.has_root() || relative.starts_with('/') {
        return Err("Invalid path.".into());
    }
    let absolute = normalize(&root.join(candidate));
    if absolute != root && !absolute.starts_with(root) {
        return Err("That path is outside the vault.".into());
    }
    Ok(absolute)
}

// writes must not follow a link out of the vault
fn check_real(absolute: &Path) -> Result<()> {
    let (_, real_root) = roots()?;
    let mut dir = absolute.parent().map(Path::to_path_buf).unwrap_or_default();
    while !exists(&dir) {
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
    let real = dunce::canonicalize(&dir).map_err(err)?;
    if real != real_root && !real.starts_with(&real_root) {
        return Err("That path is outside the vault.".into());
    }
    Ok(())
}

fn to_relative(root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(root)
        .map(|rest| {
            rest.components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

fn is_hidden(relative: &str) -> bool {
    relative
        .split('/')
        .enumerate()
        .any(|(index, part)| part.starts_with('.') && !(index == 0 && part == ".trash"))
}

fn is_page(relative: &str) -> bool {
    let lower = relative.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".canvas")
}

fn birth(info: &fs::Metadata) -> f64 {
    let created = millis(info.created());
    if created > 0.0 {
        created
    } else {
        millis(info.modified())
    }
}

pub fn scan() -> Result<Value> {
    let (root, _) = roots()?;
    let mut pages: Vec<(PathBuf, String)> = Vec::new();
    let mut folders: Vec<Value> = Vec::new();
    let mut others: Vec<String> = Vec::new();
    let mut count = 0usize;
    let mut stack = vec![(root.clone(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH || count > MAX_FILES {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            count += 1;
            if count > MAX_FILES {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let absolute = entry.path();
            let relative = to_relative(&root, &absolute);
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if name.contains(TEMP_MARK) || kind.is_symlink() || is_hidden(&relative) {
                continue;
            }
            if kind.is_dir() {
                let mtime = fs::metadata(&absolute)
                    .map(|info| millis(info.modified()))
                    .unwrap_or(0.0);
                let empty = fs::read_dir(&absolute)
                    .map(|mut items| items.next().is_none())
                    .unwrap_or(false);
                folders.push(json!({ "path": relative, "mtime": mtime, "empty": empty }));
                stack.push((absolute, depth + 1));
            } else if kind.is_file() {
                if is_page(&relative) {
                    pages.push((absolute, relative));
                } else {
                    others.push(relative);
                }
            }
        }
    }
    // pages are read many at a time, which is far quicker than one by one on every kind of disk
    let read: Vec<std::result::Result<Value, String>> = pages
        .into_par_iter()
        .filter_map(|(absolute, relative)| {
            let Ok(info) = fs::metadata(&absolute) else {
                return Some(Err(relative));
            };
            if info.len() > MAX_TEXT_BYTES {
                return Some(Err(relative));
            }
            let text = fs::read(&absolute).ok()?;
            Some(Ok(json!({
                "path": relative,
                "text": String::from_utf8_lossy(&text),
                "mtime": millis(info.modified()),
                "birthtime": birth(&info),
            })))
        })
        .collect();
    let mut files = Vec::with_capacity(read.len());
    for item in read {
        match item {
            Ok(file) => files.push(file),
            Err(relative) => others.push(relative),
        }
    }
    let json_at = |relative: &str| paths::read_json(&root.join(relative)).unwrap_or(Value::Null);
    Ok(json!({
        "files": files,
        "folders": folders,
        "others": others,
        "registry": json_at(".morrow/workspace.json"),
        "recent": json_at(".morrow/recent.json"),
    }))
}

fn read_text_or_none(absolute: &Path) -> Result<Option<String>> {
    match fs::read(absolute) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(err(error)),
    }
}

fn random_hex(len: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| format!("{:x}", rng.gen_range(0..16)))
        .collect()
}

// writes beside the target first, so a crash never leaves half a file
fn write_atomic(absolute: &Path, data: &[u8]) -> Result<()> {
    check_real(absolute)?;
    let parent = absolute.parent().ok_or("Invalid path.")?;
    fs::create_dir_all(parent).map_err(err)?;
    let temp = parent.join(format!("{TEMP_MARK}{}", random_hex(12)));
    fs::write(&temp, data).map_err(err)?;
    fs::rename(&temp, absolute).map_err(|error| {
        let _ = fs::remove_file(&temp);
        err(error)
    })
}

fn some<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum VaultOp {
    Write {
        path: String,
        text: String,
        // missing means write whatever is there, null means only when there is no file yet
        #[serde(default, deserialize_with = "some")]
        expect: Option<Option<String>>,
    },
    Rename {
        from: String,
        to: String,
        #[serde(default)]
        optional: bool,
    },
    Remove {
        path: String,
    },
    Rmdir {
        path: String,
    },
    Delete {
        path: String,
    },
}

fn failed(code: &str, message: impl Into<String>) -> Value {
    json!({ "ok": false, "code": code, "message": message.into() })
}

fn apply_one(op: VaultOp) -> Result<Value> {
    match op {
        VaultOp::Write { path, text, expect } => {
            let absolute = resolve(&path)?;
            if let Some(expect) = expect {
                let current = read_text_or_none(&absolute)?;
                if current != expect {
                    return Ok(json!({
                        "ok": false,
                        "code": "conflict",
                        "message": format!("{path} changed on disk."),
                        "current": current,
                    }));
                }
            }
            write_atomic(&absolute, text.as_bytes())?;
        }
        VaultOp::Rename {
            from: from_rel,
            to: to_rel,
            optional,
        } => {
            let from = resolve(&from_rel)?;
            let to = resolve(&to_rel)?;
            if !exists(&from) {
                return Ok(if optional {
                    json!({ "ok": true })
                } else {
                    failed("error", format!("{from_rel} is missing."))
                });
            }
            let case_only =
                from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
            if !case_only && exists(&to) {
                return Ok(failed("exists", format!("{to_rel} already exists.")));
            }
            check_real(&from)?;
            check_real(&to)?;
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(err)?;
            }
            fs::rename(&from, &to).map_err(err)?;
        }
        VaultOp::Remove { path } => {
            let absolute = resolve(&path)?;
            if !exists(&absolute) {
                return Ok(json!({ "ok": true }));
            }
            check_real(&absolute)?;
            if trash::delete(&absolute).is_err() {
                // without a system trash the file is kept in the vault's own deleted folder instead
                let (root, _) = roots()?;
                let keep = root.join(".morrow").join("deleted").join(format!(
                    "{}-{}",
                    paths::now_ms(),
                    base_name(&absolute)
                ));
                fs::create_dir_all(keep.parent().unwrap_or(&root)).map_err(err)?;
                fs::rename(&absolute, &keep).map_err(err)?;
            }
        }
        VaultOp::Delete { path } => {
            // only morrow's own bookkeeping is ever deleted outright, pages always go to the trash
            if !path.starts_with(".morrow/") {
                return Ok(failed("error", "Only Morrow files can be deleted."));
            }
            let absolute = resolve(&path)?;
            match fs::remove_file(&absolute) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(err(error))
                }
                _ => {}
            }
        }
        VaultOp::Rmdir { path } => {
            // folders that still hold something stay
            let _ = fs::remove_dir(resolve(&path)?);
        }
    }
    Ok(json!({ "ok": true }))
}

pub fn apply(ops: Value) -> Vec<Value> {
    let Value::Array(ops) = ops else {
        return vec![failed("error", "Invalid operations.")];
    };
    let mut results = Vec::new();
    for raw in ops {
        let result = match serde_json::from_value::<VaultOp>(raw) {
            Ok(op) => apply_one(op).unwrap_or_else(|error| failed("error", error)),
            Err(_) => failed("error", "Unknown operation."),
        };
        let ok = result["ok"].as_bool() == Some(true);
        results.push(result);
        if !ok {
            break;
        }
    }
    results
}

pub fn read_text(relative: &str) -> Result<Option<String>> {
    read_text_or_none(&resolve(relative)?)
}

pub fn read_bytes(relative: &str) -> Option<Vec<u8>> {
    let absolute = resolve(relative).ok()?;
    let info = fs::metadata(&absolute).ok()?;
    if !info.is_file() || info.len() > MAX_FILE_BYTES {
        return None;
    }
    fs::read(absolute).ok()
}

pub fn create_file(relative: &str, data: &[u8]) -> Result<()> {
    let absolute = resolve(relative)?;
    if exists(&absolute) {
        return Err("A file with that name already exists.".into());
    }
    write_atomic(&absolute, data)
}

pub fn path_exists(relative: &str) -> Result<bool> {
    Ok(exists(&resolve(relative)?))
}

pub fn list(relative: &str) -> Result<Vec<Value>> {
    let (root, _) = roots()?;
    let dir = resolve_in(&root, relative)?;
    let mut result = Vec::new();
    let mut stack = vec![(dir, 0usize)];
    while let Some((current, depth)) = stack.pop() {
        if depth > 16 {
            continue;
        }
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if entry.file_name().to_string_lossy().contains(TEMP_MARK) || kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                stack.push((entry.path(), depth + 1));
            } else if kind.is_file() {
                if let Ok(info) = entry.metadata() {
                    result.push(json!({
                        "path": to_relative(&root, &entry.path()),
                        "size": info.len(),
                        "mtime": millis(info.modified()),
                    }));
                }
            }
        }
    }
    Ok(result)
}

// ---- for sync between computers

// files every computer shares: pages, attachments, the trash and the shared part of morrow's bookkeeping
pub fn is_synced_path(relative: &str) -> bool {
    if relative.is_empty() || relative.contains(TEMP_MARK) || relative.contains(".morrow-move-") {
        return false;
    }
    if relative == ".morrow/workspace.json" || relative == ".morrow/review.json" {
        return true;
    }
    !is_hidden(relative)
}

fn hash_file(absolute: &Path, size: u64, mtime: f64) -> Option<String> {
    let mut guard = HASHES.lock().ok()?;
    let cache = guard.get_or_insert_with(HashMap::new);
    if let Some((cached_size, cached_mtime, hash)) = cache.get(absolute) {
        if *cached_size == size && *cached_mtime == mtime {
            return Some(hash.clone());
        }
    }
    let data = fs::read(absolute).ok()?;
    let hash = hex(&Sha256::digest(&data));
    cache.insert(absolute.to_path_buf(), (size, mtime, hash.clone()));
    Some(hash)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// every synced file in the open vault with a hash of its bytes
pub fn manifest() -> Result<serde_json::Map<String, Value>> {
    let (root, _) = roots()?;
    let mut manifest = serde_json::Map::new();
    let mut count = 0usize;
    let mut stack = vec![(root.clone(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH || count > MAX_FILES {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            count += 1;
            let absolute = entry.path();
            let relative = to_relative(&root, &absolute);
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if is_synced_path(&relative) || relative == ".morrow" {
                    stack.push((absolute, depth + 1));
                }
            } else if kind.is_file() && is_synced_path(&relative) {
                let Ok(info) = entry.metadata() else { continue };
                if info.len() > MAX_FILE_BYTES {
                    continue;
                }
                if let Some(hash) = hash_file(&absolute, info.len(), millis(info.modified())) {
                    manifest.insert(relative, Value::String(hash));
                }
            }
        }
    }
    Ok(manifest)
}

pub fn synced_file_base64(relative: &str) -> Option<String> {
    use base64::Engine;
    if !is_synced_path(relative) {
        return None;
    }
    read_bytes(relative).map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
}

// writes a file that came from another computer, only when this computer's copy is still the one the plan saw
pub fn write_synced(relative: &str, data: &str, expect: Option<String>) -> Result<Value> {
    use base64::Engine;
    if !is_synced_path(relative) {
        return Ok(failed("error", "Invalid file."));
    }
    let absolute = resolve(relative)?;
    let current = fs::read(&absolute)
        .ok()
        .map(|bytes| hex(&Sha256::digest(&bytes)));
    if current != expect {
        return Ok(json!({
            "ok": false,
            "code": "conflict",
            "message": format!("{relative} changed meanwhile."),
            "current": null,
        }));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(err)?;
    write_atomic(&absolute, &bytes)?;
    Ok(json!({ "ok": true }))
}

fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

// each vault has an id, so two computers only sync folders that are copies of the same vault
pub fn identity() -> Result<Value> {
    let (root, _) = roots()?;
    let file = root.join(".morrow").join("vault.json");
    let name = base_name(&root);
    if let Some(id) = paths::read_json(&file).and_then(|raw| raw["id"].as_str().map(String::from)) {
        if valid_id(&id) {
            return Ok(json!({ "id": id, "name": name }));
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let body = format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({ "version": 1, "id": id })).map_err(err)?
    );
    write_atomic(&file, body.as_bytes())?;
    Ok(json!({ "id": id, "name": name }))
}

// prepares an empty folder to become a copy of a vault on another computer
pub fn prepare_copy(dir: &str, vault_id: &str) -> Value {
    let path = Path::new(dir);
    if !path.is_absolute() || !valid_id(vault_id) {
        return json!({ "ok": false, "error": "Invalid folder." });
    }
    let Ok(entries) = fs::read_dir(path) else {
        return json!({ "ok": false, "error": "That folder does not exist." });
    };
    if entries
        .flatten()
        .any(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
    {
        return json!({ "ok": false, "error": "Choose an empty folder for the copy." });
    }
    let body = format!("{}\n", json!({ "version": 1, "id": vault_id }));
    match paths::write_atomic_plain(&path.join(".morrow").join("vault.json"), body.as_bytes()) {
        Ok(()) => json!({ "ok": true }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

pub fn read_sync_base(peer_id: &str) -> Value {
    let Some(root) = current().filter(|_| valid_id(peer_id)) else {
        return json!({});
    };
    paths::read_json(
        &root
            .join(".morrow")
            .join("sync")
            .join(format!("{peer_id}.json")),
    )
    .map(|raw| raw["files"].clone())
    .filter(Value::is_object)
    .unwrap_or_else(|| json!({}))
}

pub fn write_sync_base(peer_id: &str, files: Value) -> Result<()> {
    let Some(root) = current().filter(|_| valid_id(peer_id) && files.is_object()) else {
        return Ok(());
    };
    let body = json!({ "version": 1, "files": files }).to_string();
    write_atomic(
        &root
            .join(".morrow")
            .join("sync")
            .join(format!("{peer_id}.json")),
        body.as_bytes(),
    )
}

fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

// pictures, sound, video and pdfs open in the app the system uses for them. nothing that could run as a
// program is ever opened this way, whatever is in the vault
pub fn openable(path: &str) -> bool {
    matches!(
        extension(path).as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "avif"
            | "bmp"
            | "svg"
            | "ico"
            | "tif"
            | "tiff"
            | "heic"
            | "mp3"
            | "m4a"
            | "wav"
            | "ogg"
            | "oga"
            | "flac"
            | "aac"
            | "opus"
            | "mp4"
            | "m4v"
            | "webm"
            | "mov"
            | "mkv"
            | "pdf"
    )
}

// documents a link in a page can open straight away. anything else, a program above all, is only shown in
// its folder, so a link can never run something
fn openable_document(path: &str) -> bool {
    matches!(
        extension(path).as_str(),
        "txt"
            | "md"
            | "markdown"
            | "csv"
            | "rtf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "odt"
            | "ods"
            | "odp"
            | "epub"
            | "htm"
            | "html"
            | "json"
            | "xml"
            | "zip"
            | "7z"
            | "rar"
            | "tar"
            | "gz"
    )
}

pub enum LinkAction {
    Open(PathBuf),
    Reveal(PathBuf),
}

// a link to a file or folder on the computer: file:// addresses, paths from the home folder or a drive, and
// paths relative to the page the link is in, like ../Reading/paper.pdf
pub fn local_link(href: &str, page_path: Option<&str>) -> Option<LinkAction> {
    let value = href.trim();
    if value.is_empty() {
        return None;
    }
    let target = if value.to_ascii_lowercase().starts_with("file:") {
        url::Url::parse(value).ok()?.to_file_path().ok()?
    } else {
        let decoded = percent_encoding::percent_decode_str(value)
            .decode_utf8()
            .ok()?
            .into_owned();
        if let Some(rest) = decoded
            .strip_prefix("~/")
            .or_else(|| decoded.strip_prefix("~\\"))
        {
            paths::home_dir().join(rest)
        } else if Path::new(&decoded).is_absolute() {
            PathBuf::from(decoded)
        } else {
            let (root, _) = roots().ok()?;
            let from = match page_path.filter(|path| !path.is_empty()) {
                Some(page) => resolve_in(&root, page).ok()?.parent()?.to_path_buf(),
                None => root,
            };
            normalize(&from.join(decoded))
        }
    };
    let info = fs::metadata(&target).ok()?;
    let text = target.to_string_lossy();
    if info.is_dir() || openable(&text) || openable_document(&text) {
        Some(LinkAction::Open(target))
    } else {
        Some(LinkAction::Reveal(target))
    }
}

// the absolute path of a vault file for the file protocol, None when it is outside the vault
pub fn file_path(relative: &str) -> Option<PathBuf> {
    resolve(relative).ok()
}

// changes are gathered for a moment, then each path is looked at once
fn start_watching(
    root: &Path,
    on_changes: impl Fn(Vec<Value>) + Send + 'static,
) -> Option<notify::RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};
    let (send, receive) = mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            for path in event.paths {
                let _ = send.send(path);
            }
        }
    })
    .ok()?;
    watcher.watch(root, RecursiveMode::Recursive).ok()?;
    let root = root.to_path_buf();
    std::thread::spawn(move || loop {
        // the channel closes when the watcher is dropped, which ends this thread
        let Ok(first) = receive.recv() else { return };
        let mut pending: HashSet<PathBuf> = HashSet::from([first]);
        while let Ok(more) = receive.recv_timeout(Duration::from_millis(150)) {
            pending.insert(more);
        }
        let mut changes = Vec::new();
        for absolute in pending {
            let relative = to_relative(&root, &absolute);
            if relative.is_empty() || relative.contains(TEMP_MARK) || is_hidden(&relative) {
                continue;
            }
            describe(&root, &absolute, &relative, &mut changes, 0);
        }
        if !changes.is_empty() {
            on_changes(changes);
        }
    });
    Some(watcher)
}

fn describe(root: &Path, absolute: &Path, relative: &str, changes: &mut Vec<Value>, depth: usize) {
    let Ok(info) = fs::symlink_metadata(absolute) else {
        let page = is_page(relative);
        changes.push(json!({
            "path": relative,
            "text": null,
            "mtime": paths::now_ms(),
            "birthtime": 0,
            "dir": !page,
            "other": !page,
        }));
        return;
    };
    if info.file_type().is_symlink() {
        return;
    }
    if info.is_dir() {
        // a folder moved in from elsewhere arrives as one event, its contents are reported one by one
        if depth > 16 {
            return;
        }
        let Ok(entries) = fs::read_dir(absolute) else {
            return;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            let child_relative = to_relative(root, &child);
            if entry.file_name().to_string_lossy().contains(TEMP_MARK) || is_hidden(&child_relative)
            {
                continue;
            }
            describe(root, &child, &child_relative, changes, depth + 1);
        }
    } else if info.is_file() {
        let mtime = millis(info.modified());
        let birthtime = birth(&info);
        if !is_page(relative) {
            changes.push(json!({ "path": relative, "text": "", "mtime": mtime, "birthtime": birthtime, "other": true }));
        } else if info.len() <= MAX_TEXT_BYTES {
            if let Ok(bytes) = fs::read(absolute) {
                changes.push(json!({
                    "path": relative,
                    "text": String::from_utf8_lossy(&bytes),
                    "mtime": mtime,
                    "birthtime": birthtime,
                }));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_vault() {
        let root = Path::new("/notes");
        assert_eq!(
            resolve_in(root, "a/b.md").unwrap(),
            Path::new("/notes/a/b.md")
        );
        assert!(resolve_in(root, "../etc/passwd").is_err());
        assert!(resolve_in(root, "a/../../x").is_err());
        assert!(resolve_in(root, "/etc/passwd").is_err());
        assert!(resolve_in(root, "a\\b").is_err());
        assert!(resolve_in(root, "").is_err());
        assert_eq!(
            resolve_in(root, "a/../b.md").unwrap(),
            Path::new("/notes/b.md")
        );
    }

    #[test]
    fn hidden_and_synced_paths() {
        assert!(is_hidden(".morrow/history/x.json"));
        assert!(!is_hidden(".trash/Old.md"));
        assert!(is_hidden("a/.trash/x"));
        assert!(is_synced_path(".morrow/workspace.json"));
        assert!(!is_synced_path(".morrow/recent.json"));
        assert!(is_synced_path("Notes/Page.md"));
    }

    #[test]
    fn ops_keep_undefined_and_null_apart() {
        let missing: VaultOp =
            serde_json::from_value(json!({ "op": "write", "path": "a.md", "text": "" })).unwrap();
        let null: VaultOp = serde_json::from_value(
            json!({ "op": "write", "path": "a.md", "text": "", "expect": null }),
        )
        .unwrap();
        assert!(matches!(missing, VaultOp::Write { expect: None, .. }));
        assert!(matches!(
            null,
            VaultOp::Write {
                expect: Some(None),
                ..
            }
        ));
    }
}
