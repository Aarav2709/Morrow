// morrow in the background: opening with the computer, perhaps minimized, so reminders go off without it
// being opened first, and a small box for a note from any app that leaves the main window where it is
use serde::{Deserialize, Serialize};

const FILE: &str = "background.json";
// the argument the computer starts morrow with, so it knows it was not opened by hand
pub const AUTOSTART_ARG: &str = "--autostart";
pub const CAPTURE_SHORTCUT: &str = "CommandOrControl+Alt+M";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Background {
    pub start_minimized: bool,
    pub quick_capture: bool,
}

impl Default for Background {
    fn default() -> Self {
        Self {
            start_minimized: false,
            quick_capture: true,
        }
    }
}

pub fn read() -> Background {
    std::fs::read_to_string(crate::paths::data_dir().join(FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn write(settings: &Background) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    std::fs::write(crate::paths::data_dir().join(FILE), text).map_err(|error| error.to_string())
}

// opened by the computer as it started, rather than by hand
pub fn launched_at_login() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}
