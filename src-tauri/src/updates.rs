// new versions come from the github releases this repository publishes. only checked when the person
// turned it on or pressed the button, and installed only when they say so
use crate::vault::hex;
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const LATEST: &str = "https://api.github.com/repos/Aarav2709/Morrow/releases/latest";

#[derive(Clone)]
struct Asset {
    url: String,
    size: u64,
    digest: Option<String>,
    name: String,
}

static LATEST_ASSET: Mutex<Option<Asset>> = Mutex::new(None);

// 1.10.0 is newer than 1.9.2, and a version with a suffix like 1.2.0-beta comes before 1.2.0
pub fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |version: &str| {
        let version = version.trim_start_matches('v');
        let (core, pre) = match version.split_once('-') {
            Some((core, pre)) => (core, Some(pre.to_string())),
            None => (version, None),
        };
        let parts: Vec<u64> = core
            .split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect();
        (parts, pre)
    };
    let (a, a_pre) = parse(candidate);
    let (b, b_pre) = parse(current);
    for i in 0..3 {
        let (x, y) = (
            a.get(i).copied().unwrap_or(0),
            b.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x > y;
        }
    }
    match (a_pre, b_pre) {
        (a, b) if a == b => false,
        (None, _) => true,
        (Some(_), None) => false,
        (Some(a), Some(b)) => a > b,
    }
}

fn arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

// a copy installed by the windows installer has the uninstaller beside it, a copy run from elsewhere does not
fn installed_on_windows() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

// the file this copy of morrow can install itself from, None when it has to be downloaded by hand
fn installer_for(assets: &[Value], version: &str) -> Option<Asset> {
    let wanted = if cfg!(windows) && installed_on_windows() {
        format!("Morrow_{version}_{}-setup.exe", arch())
    } else if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_some() {
        let arch = if arch() == "x64" { "amd64" } else { "aarch64" };
        format!("Morrow_{version}_{arch}.AppImage")
    } else {
        return None;
    };
    assets
        .iter()
        .find(|asset| asset["name"].as_str() == Some(&wanted))
        .map(|asset| Asset {
            url: asset["browser_download_url"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            size: asset["size"].as_u64().unwrap_or(0),
            digest: asset["digest"].as_str().map(String::from),
            name: wanted.clone(),
        })
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Morrow/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}

pub async fn check() -> Result<Value, String> {
    let response = client()
        .get(LATEST)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Could not reach GitHub. Are you online?".to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub answered {}.", response.status().as_u16()));
    }
    let release: Value = response.json().await.map_err(|error| error.to_string())?;
    let version = release["tag_name"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches('v')
        .to_string();
    let skip =
        release["draft"].as_bool() == Some(true) || release["prerelease"].as_bool() == Some(true);
    if version.is_empty() || skip || !is_newer(&version, env!("CARGO_PKG_VERSION")) {
        *LATEST_ASSET.lock().map_err(|e| e.to_string())? = None;
        return Ok(Value::Null);
    }
    let assets = release["assets"].as_array().cloned().unwrap_or_default();
    let asset = installer_for(&assets, &version);
    let notes: String = release["body"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(8000)
        .collect();
    let info = json!({
        "version": version,
        "notes": notes,
        "url": release["html_url"].as_str().unwrap_or("https://github.com/Aarav2709/Morrow/releases/latest"),
        "installable": asset.is_some(),
    });
    *LATEST_ASSET.lock().map_err(|e| e.to_string())? = asset;
    Ok(info)
}

// downloads the new version, checks it is the file github says it is, then hands over to it
pub async fn install<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    on_progress: impl Fn(f64),
) -> Result<(), String> {
    let asset = LATEST_ASSET
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("There is no update to install.")?;
    let response = client()
        .get(&asset.url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "The download failed ({}).",
            response.status().as_u16()
        ));
    }
    let mut data = Vec::with_capacity(asset.size as usize);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        data.extend_from_slice(&chunk.map_err(|error| error.to_string())?);
        on_progress(if asset.size > 0 {
            (data.len() as f64 / asset.size as f64).min(1.0)
        } else {
            0.0
        });
    }
    if let Some(expected) = asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
    {
        if hex(&Sha256::digest(&data)) != expected.to_ascii_lowercase() {
            return Err("The download did not match the release, so it was not installed.".into());
        }
    }
    if cfg!(windows) {
        let file = std::env::temp_dir().join(&asset.name);
        std::fs::write(&file, &data).map_err(|error| error.to_string())?;
        // the installer replaces this copy where it is installed, shows only its progress, and starts it again
        std::process::Command::new(&file)
            .args(["/P", "/R"])
            .spawn()
            .map_err(|error| error.to_string())?;
        app.exit(0);
        return Ok(());
    }
    let target =
        std::env::var_os("APPIMAGE").ok_or("This copy of Morrow can not update itself.")?;
    let target = std::path::PathBuf::from(target);
    let next = target.with_extension("AppImage.update");
    let replace = || -> std::io::Result<()> {
        std::fs::write(&next, &data)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&next, std::fs::Permissions::from_mode(0o755))?;
        }
        std::fs::rename(&next, &target)
    };
    if let Err(error) = replace() {
        let _ = std::fs::remove_file(&next);
        return Err(error.to_string());
    }
    std::process::Command::new(&target)
        .spawn()
        .map_err(|error| error.to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_versions() {
        assert!(is_newer("2.0.0", "1.4.0"));
        assert!(is_newer("1.10.0", "1.9.2"));
        assert!(!is_newer("1.4.0", "1.4.0"));
        assert!(is_newer("1.2.0", "1.2.0-beta"));
        assert!(!is_newer("1.2.0-beta", "1.2.0"));
        assert!(is_newer("v2.0.1", "2.0.0"));
    }
}
