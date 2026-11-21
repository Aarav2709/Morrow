// Agent Client Protocol (ACP) host for local CLI agents over stdio JSON-RPC 2.0.
// Desktop only: spawns configured agent binaries (or runs them via WSL on Windows),
// routes streaming session/update notifications, handles fs/* and terminal/* callbacks,
// and suspends session/request_permission until the user approves or declines.

use crate::{mcp, paths, vault};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

const MAX_TERMINAL_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT_SECS: u64 = 120;

#[derive(Clone, Copy)]
struct PresetDef {
    id: &'static str,
    display_name: &'static str,
    default_command: &'static str,
    default_args: &'static [&'static str],
}

const PRESETS: [PresetDef; 11] = [
    PresetDef {
        id: "claude-code-acp",
        display_name: "Claude Code",
        default_command: "claude-code-acp",
        default_args: &[],
    },
    PresetDef {
        id: "codex-acp",
        display_name: "Codex",
        default_command: "codex-acp",
        default_args: &[],
    },
    PresetDef {
        id: "gemini-cli",
        display_name: "Gemini CLI",
        default_command: "gemini",
        default_args: &["--experimental-acp"],
    },
    PresetDef {
        id: "mistral-vibe",
        display_name: "Mistral Vibe",
        default_command: "vibe-acp",
        default_args: &[],
    },
    PresetDef {
        id: "opencode",
        display_name: "OpenCode",
        default_command: "opencode",
        default_args: &["acp"],
    },
    PresetDef {
        id: "kiro-cli",
        display_name: "Kiro",
        default_command: "kiro-cli",
        default_args: &["acp"],
    },
    PresetDef {
        id: "hermes-agent",
        display_name: "Hermes Agent",
        default_command: "hermes",
        default_args: &["acp"],
    },
    PresetDef {
        id: "pi-acp",
        display_name: "Pi",
        default_command: "pi-acp",
        default_args: &[],
    },
    PresetDef {
        id: "grok-build",
        display_name: "Grok Build",
        default_command: "grok-build",
        default_args: &["acp"],
    },
    PresetDef {
        id: "bob-acp",
        display_name: "IBM Bob",
        default_command: "bob-acp",
        default_args: &[],
    },
    PresetDef {
        id: "antigravity-cli",
        display_name: "Antigravity CLI",
        default_command: "agy",
        default_args: &["acp"],
    },
];

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PresetOverride {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    command: String,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    env: HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentConfig {
    pub id: String,
    pub display_name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    #[serde(default = "default_agent_id")]
    default_agent_id: String,
    #[serde(default)]
    node_path: String,
    #[serde(default)]
    wsl_mode: bool,
    #[serde(default)]
    presets: HashMap<String, PresetOverride>,
    #[serde(default)]
    custom_agents: Vec<CustomAgentConfig>,
}

fn default_agent_id() -> String {
    "claude-code-acp".to_string()
}

impl Default for StoredConfig {
    fn default() -> Self {
        Self {
            default_agent_id: default_agent_id(),
            node_path: String::new(),
            wsl_mode: false,
            presets: HashMap::new(),
            custom_agents: Vec::new(),
        }
    }
}

pub type EmitFn = Box<dyn Fn(Value) + Send + Sync>;
pub type NotifyFn = Box<dyn Fn(&str, &str) + Send + Sync>;
type PendingRpcMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct HostHooks {
    pub emit: EmitFn,
    pub notify_if_unfocused: NotifyFn,
    pub mcp_command: Option<(String, String)>,
}

pub struct StartSessionParams {
    pub client_session_id: String,
    pub agent_id: String,
    pub existing_agent_session_id: Option<String>,
    pub cwd_override: Option<String>,
    pub mcp_enabled: bool,
    pub auto_allow: bool,
    pub system_notifications: bool,
}

struct LaunchSpec {
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    node_path: String,
    wsl_mode: bool,
}

struct PendingTerminal {
    output: Arc<Mutex<TerminalBuffer>>,
    child: Arc<AsyncMutex<Option<Child>>>,
    exit_rx: Arc<AsyncMutex<Option<oneshot::Receiver<Option<i32>>>>>,
    exit_status: Arc<Mutex<Option<Option<i32>>>>,
}

struct TerminalBuffer {
    bytes: Vec<u8>,
    truncated: bool,
    limit: usize,
}

impl TerminalBuffer {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            truncated: false,
            limit: limit.clamp(4096, MAX_TERMINAL_BYTES),
        }
    }

    fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() > self.limit {
            let excess = self.bytes.len() - self.limit;
            self.bytes.drain(0..excess);
            self.truncated = true;
        }
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
}

struct SessionRuntime {
    client_session_id: String,
    agent_session_id: Arc<Mutex<Option<String>>>,
    cwd: PathBuf,
    wsl_mode: bool,
    stdin: Arc<AsyncMutex<ChildStdin>>,
    child: Arc<AsyncMutex<Child>>,
    pending_rpc: PendingRpcMap,
    terminals: Arc<Mutex<HashMap<String, PendingTerminal>>>,
    auto_allow: Arc<AtomicBool>,
    system_notifications: Arc<AtomicBool>,
    next_rpc_id: AtomicU64,
    hooks: Arc<HostHooks>,
}

static CONFIG_LOCK: Mutex<Option<StoredConfig>> = Mutex::new(None);
static SESSIONS: OnceLock<AsyncMutex<HashMap<String, Arc<SessionRuntime>>>> = OnceLock::new();
static PENDING_PERMISSIONS: OnceLock<Mutex<HashMap<String, oneshot::Sender<Option<String>>>>> =
    OnceLock::new();
static NEXT_REQ_ID: AtomicU64 = AtomicU64::new(1);

fn sessions_map() -> &'static AsyncMutex<HashMap<String, Arc<SessionRuntime>>> {
    SESSIONS.get_or_init(|| AsyncMutex::new(HashMap::new()))
}

fn permissions_map() -> &'static Mutex<HashMap<String, oneshot::Sender<Option<String>>>> {
    PENDING_PERMISSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn config_file() -> PathBuf {
    paths::data_dir().join("acp.json")
}

fn load_config() -> StoredConfig {
    let mut guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(cfg) = guard.as_ref() {
        return cfg.clone();
    }
    let cfg = paths::read_json(&config_file())
        .and_then(|v| serde_json::from_value::<StoredConfig>(v).ok())
        .unwrap_or_default();
    *guard = Some(cfg.clone());
    cfg
}

fn save_config(cfg: StoredConfig) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(&cfg).map_err(|e| e.to_string())?;
    let file = config_file();
    paths::write_atomic_plain(&file, &body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    let mut guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(cfg);
    Ok(())
}

pub fn detect_node() -> Option<String> {
    mcp::find_node().map(|p| p.to_string_lossy().into_owned())
}

fn public_settings(cfg: &StoredConfig) -> Value {
    let presets: Vec<Value> = PRESETS
        .iter()
        .map(|preset| {
            let over = cfg.presets.get(preset.id);
            let default_args: Vec<String> = preset
                .default_args
                .iter()
                .map(|s| (*s).to_string())
                .collect();
            json!({
                "id": preset.id,
                "displayName": preset.display_name,
                "defaultCommand": preset.default_command,
                "defaultArgs": default_args,
                "enabled": over.map(|o| o.enabled).unwrap_or(true),
                "command": over.map(|o| o.command.clone()).unwrap_or_default(),
                "args": over.and_then(|o| o.args.clone()).unwrap_or(default_args),
                "env": over.map(|o| o.env.clone()).unwrap_or_default(),
            })
        })
        .collect();
    let current_vault_path = vault::current().map(|p| p.to_string_lossy().into_owned());
    json!({
        "defaultAgentId": cfg.default_agent_id,
        "nodePath": cfg.node_path,
        "detectedNodePath": detect_node(),
        "wslMode": cfg.wsl_mode,
        "presets": presets,
        "customAgents": cfg.custom_agents,
        "currentVaultPath": current_vault_path,
    })
}

pub fn settings() -> Value {
    let cfg = load_config();
    public_settings(&cfg)
}

pub fn configure(patch: Value) -> Result<Value, String> {
    let mut cfg = load_config();
    if let Some(id) = patch.get("defaultAgentId").and_then(|v| v.as_str()) {
        cfg.default_agent_id = id.trim().to_string();
    }
    if let Some(node) = patch.get("nodePath").and_then(|v| v.as_str()) {
        cfg.node_path = node.trim().to_string();
    }
    if let Some(wsl) = patch.get("wslMode").and_then(|v| v.as_bool()) {
        cfg.wsl_mode = wsl;
    }
    if let Some(presets) = patch.get("presets").and_then(|v| v.as_array()) {
        for item in presets {
            let Some(id) = item.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let entry = cfg.presets.entry(id.to_string()).or_default();
            if let Some(enabled) = item.get("enabled").and_then(|v| v.as_bool()) {
                entry.enabled = enabled;
            }
            if let Some(command) = item.get("command").and_then(|v| v.as_str()) {
                entry.command = command.trim().to_string();
            }
            if let Some(args) = item.get("args").and_then(|v| v.as_array()) {
                entry.args = Some(
                    args.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect(),
                );
            }
            if let Some(env_obj) = item.get("env").and_then(|v| v.as_object()) {
                entry.env = env_obj
                    .iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect();
            }
        }
    }
    if let Some(custom) = patch.get("customAgents") {
        if let Ok(list) = serde_json::from_value::<Vec<CustomAgentConfig>>(custom.clone()) {
            cfg.custom_agents = list;
        }
    }
    save_config(cfg.clone())?;
    Ok(public_settings(&cfg))
}

fn resolve_agent_launch(cfg: &StoredConfig, agent_id: &str) -> Result<LaunchSpec, String> {
    if let Some(preset) = PRESETS.iter().find(|p| p.id == agent_id) {
        let over = cfg.presets.get(preset.id);
        if let Some(o) = over {
            if !o.enabled {
                return Err(format!(
                    "Agent '{}' is disabled in settings.",
                    preset.display_name
                ));
            }
        }
        let cmd = over
            .map(|o| o.command.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(preset.default_command)
            .to_string();
        let args = over.and_then(|o| o.args.clone()).unwrap_or_else(|| {
            preset
                .default_args
                .iter()
                .map(|s| (*s).to_string())
                .collect()
        });
        let env = over.map(|o| o.env.clone()).unwrap_or_default();
        return Ok(LaunchSpec {
            command: cmd,
            args,
            env,
            node_path: cfg.node_path.clone(),
            wsl_mode: cfg.wsl_mode,
        });
    }
    if let Some(custom) = cfg.custom_agents.iter().find(|c| c.id == agent_id) {
        if !custom.enabled {
            return Err(format!(
                "Agent '{}' is disabled in settings.",
                custom.display_name
            ));
        }
        if custom.command.trim().is_empty() {
            return Err(format!(
                "Custom agent '{}' has no command path set.",
                custom.display_name
            ));
        }
        return Ok(LaunchSpec {
            command: custom.command.trim().to_string(),
            args: custom.args.clone(),
            env: custom.env.clone(),
            node_path: cfg.node_path.clone(),
            wsl_mode: cfg.wsl_mode,
        });
    }
    Err(format!("Unknown ACP agent '{agent_id}'."))
}

fn augmented_path(node_path: &str) -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let trimmed = node_path.trim();
    if !trimmed.is_empty() {
        let p = PathBuf::from(trimmed);
        if p.is_dir() {
            dirs.push(p);
        } else if let Some(parent) = p.parent() {
            dirs.push(parent.to_path_buf());
        }
    } else if let Some(detected) = mcp::find_node() {
        if let Some(parent) = detected.parent() {
            dirs.push(parent.to_path_buf());
        }
    }
    let home = paths::home_dir();
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Programs").join("nodejs"));
        }
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".local").join("bin"));
    }
    #[cfg(not(windows))]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(home.join(".npm-global").join("bin"));
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".volta").join("bin"));
    }
    if let Some(existing) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(dirs)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn windows_path_to_wsl(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let bytes = s.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let rest = s[2..].trim_start_matches('/');
        if rest.is_empty() {
            format!("/mnt/{drive}")
        } else {
            format!("/mnt/{drive}/{rest}")
        }
    } else {
        s
    }
}

fn shell_quote_single(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_wsl_command_line(command: &str, args: &[String], env: &HashMap<String, String>) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (k, v) in env {
        if !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            parts.push(format!("{k}={}", shell_quote_single(v)));
        }
    }
    parts.push("exec".to_string());
    parts.push(shell_quote_single(command));
    for arg in args {
        parts.push(shell_quote_single(arg));
    }
    parts.join(" ")
}

#[cfg(windows)]
fn apply_no_window(cmd: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_no_window(_cmd: &mut Command) {}

fn spawn_agent_command(spec: &LaunchSpec, cwd: &Path) -> Result<Child, String> {
    if cfg!(windows) && spec.wsl_mode {
        let wsl_cwd = windows_path_to_wsl(cwd);
        let script = build_wsl_command_line(&spec.command, &spec.args, &spec.env);
        let mut cmd = Command::new("wsl.exe");
        cmd.arg("--cd")
            .arg(&wsl_cwd)
            .arg("--")
            .arg("sh")
            .arg("-lc")
            .arg(script);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        apply_no_window(&mut cmd);
        return cmd
            .spawn()
            .map_err(|e| format!("Could not start '{}' via WSL: {e}", spec.command));
    }

    let path_env = augmented_path(&spec.node_path);
    let resolved = which::which_in(&spec.command, Some(&path_env), cwd)
        .unwrap_or_else(|_| PathBuf::from(&spec.command));

    // Windows .cmd / .bat shims require cmd.exe /C when path contains spaces or npm wrappers
    #[cfg(windows)]
    let mut cmd = {
        let ext = resolved
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "cmd" || ext == "bat" {
            let mut c = Command::new("cmd.exe");
            c.arg("/C").arg(&resolved).args(&spec.args);
            c
        } else {
            let mut c = Command::new(&resolved);
            c.args(&spec.args);
            c
        }
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new(&resolved);
        c.args(&spec.args);
        c
    };

    cmd.current_dir(cwd)
        .env("PATH", &path_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (k, v) in &spec.env {
        if !k.trim().is_empty() {
            cmd.env(k.trim(), v);
        }
    }
    apply_no_window(&mut cmd);
    cmd.spawn().map_err(|e| {
        format!(
            "Could not start '{}' ({}): {e}",
            spec.command,
            resolved.display()
        )
    })
}

async fn write_json_line(stdin: &AsyncMutex<ChildStdin>, value: &Value) -> Result<(), String> {
    let mut line = serde_json::to_string(value).map_err(|e| e.to_string())?;
    line.push('\n');
    let mut guard = stdin.lock().await;
    guard
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Failed writing to agent stdin: {e}"))?;
    guard
        .flush()
        .await
        .map_err(|e| format!("Failed flushing agent stdin: {e}"))
}

impl SessionRuntime {
    fn emit_debug(&self, direction: &str, line: &str) {
        (self.hooks.emit)(json!({
            "kind": "debug",
            "clientSessionId": self.client_session_id,
            "direction": direction,
            "line": line,
        }));
    }

    async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_rpc_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending_rpc.lock().unwrap_or_else(|e| e.into_inner());
            pending.insert(id, tx);
        }
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.emit_debug("out", &payload.to_string());
        if let Err(err) = write_json_line(&self.stdin, &payload).await {
            let mut pending = self.pending_rpc.lock().unwrap_or_else(|e| e.into_inner());
            pending.remove(&id);
            return Err(err);
        }
        let timeout = if method == "session/prompt" {
            tokio::time::Duration::from_secs(3600)
        } else {
            tokio::time::Duration::from_secs(REQUEST_TIMEOUT_SECS)
        };
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("Agent process closed before answering.".to_string()),
            Err(_) => {
                let mut pending = self.pending_rpc.lock().unwrap_or_else(|e| e.into_inner());
                pending.remove(&id);
                Err(format!("Timed out waiting for '{method}'."))
            }
        }
    }

    async fn send_notification(&self, method: &str, params: Value) -> Result<(), String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.emit_debug("out", &payload.to_string());
        write_json_line(&self.stdin, &payload).await
    }

    async fn send_response(&self, id: Value, result: Result<Value, (i64, String)>) {
        let payload = match result {
            Ok(res) => json!({ "jsonrpc": "2.0", "id": id, "result": res }),
            Err((code, message)) => {
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
            }
        };
        self.emit_debug("out", &payload.to_string());
        let _ = write_json_line(&self.stdin, &payload).await;
    }

    fn resolve_session_path(&self, raw: &str) -> PathBuf {
        let p = Path::new(raw);
        if p.is_absolute() {
            paths::normalize(p)
        } else {
            paths::normalize(&self.cwd.join(p))
        }
    }
}

fn slice_lines(text: &str, line: Option<u64>, limit: Option<u64>) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let start = line
        .and_then(|l| l.checked_sub(1))
        .map(|i| i as usize)
        .unwrap_or(0)
        .min(lines.len());
    let end = match limit {
        Some(n) => start.saturating_add(n as usize).min(lines.len()),
        None => lines.len(),
    };
    lines[start..end].join("\n")
}

async fn handle_agent_request(
    runtime: Arc<SessionRuntime>,
    id: Value,
    method: String,
    params: Value,
) {
    let result: Result<Value, (i64, String)> = match method.as_str() {
        "session/request_permission" => {
            let options = params
                .get("options")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if runtime.auto_allow.load(Ordering::SeqCst) {
                let picked = options
                    .iter()
                    .find(|o| {
                        matches!(
                            o.get("kind").and_then(|k| k.as_str()),
                            Some("allow_once" | "allow_always")
                        )
                    })
                    .or_else(|| options.first())
                    .and_then(|o| o.get("optionId").and_then(|v| v.as_str()))
                    .map(String::from);
                Ok(match picked {
                    Some(option_id) => json!({
                        "outcome": { "outcome": "selected", "optionId": option_id }
                    }),
                    None => json!({ "outcome": { "outcome": "cancelled" } }),
                })
            } else {
                let req_id = format!("perm-{}", NEXT_REQ_ID.fetch_add(1, Ordering::SeqCst));
                let (tx, rx) = oneshot::channel();
                {
                    let mut map = permissions_map().lock().unwrap_or_else(|e| e.into_inner());
                    map.insert(req_id.clone(), tx);
                }
                let tool_call = params.get("toolCall").cloned().unwrap_or(json!({}));
                (runtime.hooks.emit)(json!({
                    "kind": "permissionRequest",
                    "clientSessionId": runtime.client_session_id,
                    "requestId": req_id,
                    "toolCall": tool_call,
                    "options": options,
                }));
                if runtime.system_notifications.load(Ordering::SeqCst) {
                    let title = tool_call
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Permission needed");
                    (runtime.hooks.notify_if_unfocused)("Agent permission requested", title);
                }
                match rx.await {
                    Ok(Some(option_id)) => Ok(json!({
                        "outcome": { "outcome": "selected", "optionId": option_id }
                    })),
                    _ => Ok(json!({ "outcome": { "outcome": "cancelled" } })),
                }
            }
        }
        "fs/read_text_file" => {
            let Some(path_str) = params.get("path").and_then(|v| v.as_str()) else {
                runtime
                    .send_response(id, Err((-32602, "Missing path parameter".into())))
                    .await;
                return;
            };
            let target = runtime.resolve_session_path(path_str);
            let line = params.get("line").and_then(|v| v.as_u64());
            let limit = params.get("limit").and_then(|v| v.as_u64());
            match tokio::fs::read_to_string(&target).await {
                Ok(content) => Ok(json!({ "content": slice_lines(&content, line, limit) })),
                Err(err) => Err((
                    -32000,
                    format!("Could not read {}: {err}", target.display()),
                )),
            }
        }
        "fs/write_text_file" => {
            let Some(path_str) = params.get("path").and_then(|v| v.as_str()) else {
                runtime
                    .send_response(id, Err((-32602, "Missing path parameter".into())))
                    .await;
                return;
            };
            let content = params
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let target = runtime.resolve_session_path(path_str);
            let write_res = tokio::task::spawn_blocking(move || {
                paths::write_atomic_plain(&target, content.as_bytes())
                    .map_err(|e| format!("Could not write {}: {e}", target.display()))
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
            match write_res {
                Ok(()) => Ok(json!({})),
                Err(msg) => Err((-32000, msg)),
            }
        }
        "terminal/create" => create_terminal(&runtime, &params).await,
        "terminal/output" => terminal_output(&runtime, &params),
        "terminal/wait_for_exit" => terminal_wait_for_exit(&runtime, &params).await,
        "terminal/kill" => terminal_kill(&runtime, &params).await,
        "terminal/release" => terminal_release(&runtime, &params).await,
        _ => Err((-32601, format!("Method '{method}' not supported by client"))),
    };
    runtime.send_response(id, result).await;
}

async fn create_terminal(
    runtime: &Arc<SessionRuntime>,
    params: &Value,
) -> Result<Value, (i64, String)> {
    let command = params
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (-32602, "Missing terminal command".to_string()))?
        .to_string();
    let args: Vec<String> = params
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| runtime.resolve_session_path(s))
        .unwrap_or_else(|| runtime.cwd.clone());
    let limit = params
        .get("outputByteLimit")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(MAX_TERMINAL_BYTES);
    let mut env_map: HashMap<String, String> = HashMap::new();
    if let Some(env_arr) = params.get("env").and_then(|v| v.as_array()) {
        for item in env_arr {
            if let (Some(k), Some(v)) = (
                item.get("name").and_then(|n| n.as_str()),
                item.get("value").and_then(|n| n.as_str()),
            ) {
                env_map.insert(k.to_string(), v.to_string());
            }
        }
    }

    let mut cmd = if cfg!(windows) && runtime.wsl_mode {
        let wsl_cwd = windows_path_to_wsl(&cwd);
        let script = build_wsl_command_line(&command, &args, &env_map);
        let mut c = Command::new("wsl.exe");
        c.arg("--cd")
            .arg(wsl_cwd)
            .arg("--")
            .arg("sh")
            .arg("-lc")
            .arg(script);
        c
    } else if cfg!(windows) {
        let mut c = Command::new("cmd.exe");
        c.arg("/C").arg(&command).args(&args);
        c.current_dir(&cwd);
        for (k, v) in &env_map {
            c.env(k, v);
        }
        c
    } else {
        let mut c = Command::new(&command);
        c.args(&args).current_dir(&cwd);
        for (k, v) in &env_map {
            c.env(k, v);
        }
        c
    };
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| (-32000, format!("Failed to start terminal command: {e}")))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let term_id = format!("term-{}", NEXT_REQ_ID.fetch_add(1, Ordering::SeqCst));
    let buffer = Arc::new(Mutex::new(TerminalBuffer::new(limit)));
    let exit_status = Arc::new(Mutex::new(None));
    let (exit_tx, exit_rx) = oneshot::channel();
    let child_arc = Arc::new(AsyncMutex::new(Some(child)));

    let entry = PendingTerminal {
        output: buffer.clone(),
        child: child_arc.clone(),
        exit_rx: Arc::new(AsyncMutex::new(Some(exit_rx))),
        exit_status: exit_status.clone(),
    };
    {
        let mut terms = runtime.terminals.lock().unwrap_or_else(|e| e.into_inner());
        terms.insert(term_id.clone(), entry);
    }

    for mut reader in [
        stdout.map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        stderr.map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let buf_clone = buffer.clone();
        let rt_clone = runtime.clone();
        let tid = term_id.clone();
        tokio::spawn(async move {
            let mut chunk = [0u8; 4096];
            while let Ok(n) = reader.read(&mut chunk).await {
                if n == 0 {
                    break;
                }
                let snapshot = {
                    let mut b = buf_clone.lock().unwrap_or_else(|e| e.into_inner());
                    b.push(&chunk[..n]);
                    b.text()
                };
                (rt_clone.hooks.emit)(json!({
                    "kind": "terminalOutput",
                    "clientSessionId": rt_clone.client_session_id,
                    "terminalId": tid,
                    "output": snapshot,
                }));
            }
        });
    }

    let rt_wait = runtime.clone();
    let tid_wait = term_id.clone();
    let buf_wait = buffer.clone();
    tokio::spawn(async move {
        let code = loop {
            {
                let mut guard = child_arc.lock().await;
                if let Some(c) = guard.as_mut() {
                    match c.try_wait() {
                        Ok(Some(status)) => {
                            *guard = None;
                            break status.code();
                        }
                        Ok(None) => {}
                        Err(_) => {
                            *guard = None;
                            break None;
                        }
                    }
                } else {
                    break None;
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(40)).await;
        };
        {
            let mut st = exit_status.lock().unwrap_or_else(|e| e.into_inner());
            *st = Some(code);
        }
        let snapshot = buf_wait.lock().unwrap_or_else(|e| e.into_inner()).text();
        (rt_wait.hooks.emit)(json!({
            "kind": "terminalOutput",
            "clientSessionId": rt_wait.client_session_id,
            "terminalId": tid_wait,
            "output": snapshot,
            "exited": true,
            "exitCode": code,
        }));
        let _ = exit_tx.send(code);
    });

    Ok(json!({ "terminalId": term_id }))
}

fn terminal_output(runtime: &Arc<SessionRuntime>, params: &Value) -> Result<Value, (i64, String)> {
    let tid = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (-32602, "Missing terminalId".to_string()))?;
    let terms = runtime.terminals.lock().unwrap_or_else(|e| e.into_inner());
    let term = terms
        .get(tid)
        .ok_or_else(|| (-32000, format!("Unknown terminal '{tid}'")))?;
    let buf = term.output.lock().unwrap_or_else(|e| e.into_inner());
    let exit_code = *term.exit_status.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = json!({
        "output": buf.text(),
        "truncated": buf.truncated,
    });
    if let Some(code) = exit_code {
        out["exitStatus"] = json!({ "exitCode": code });
    }
    Ok(out)
}

async fn terminal_wait_for_exit(
    runtime: &Arc<SessionRuntime>,
    params: &Value,
) -> Result<Value, (i64, String)> {
    let tid = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (-32602, "Missing terminalId".to_string()))?;
    let (rx_arc, status_arc) = {
        let terms = runtime.terminals.lock().unwrap_or_else(|e| e.into_inner());
        let term = terms
            .get(tid)
            .ok_or_else(|| (-32000, format!("Unknown terminal '{tid}'")))?;
        (term.exit_rx.clone(), term.exit_status.clone())
    };
    if let Some(code) = *status_arc.lock().unwrap_or_else(|e| e.into_inner()) {
        return Ok(json!({ "exitCode": code }));
    }
    let rx = rx_arc.lock().await.take();
    let code = match rx {
        Some(rx) => rx.await.ok().flatten(),
        None => (*status_arc.lock().unwrap_or_else(|e| e.into_inner())).flatten(),
    };
    Ok(json!({ "exitCode": code }))
}

async fn terminal_kill(
    runtime: &Arc<SessionRuntime>,
    params: &Value,
) -> Result<Value, (i64, String)> {
    let tid = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (-32602, "Missing terminalId".to_string()))?;
    let child_arc = {
        let terms = runtime.terminals.lock().unwrap_or_else(|e| e.into_inner());
        terms.get(tid).map(|t| t.child.clone())
    };
    if let Some(child_arc) = child_arc {
        let mut guard = child_arc.lock().await;
        if let Some(child) = guard.as_mut() {
            let _ = child.kill().await;
        }
    }
    Ok(json!({}))
}

async fn terminal_release(
    runtime: &Arc<SessionRuntime>,
    params: &Value,
) -> Result<Value, (i64, String)> {
    let tid = params
        .get("terminalId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (-32602, "Missing terminalId".to_string()))?;
    let removed = {
        let mut terms = runtime.terminals.lock().unwrap_or_else(|e| e.into_inner());
        terms.remove(tid)
    };
    if let Some(term) = removed {
        let mut guard = term.child.lock().await;
        if let Some(child) = guard.as_mut() {
            let _ = child.kill().await;
        }
    }
    Ok(json!({}))
}

fn spawn_readers(
    runtime: Arc<SessionRuntime>,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
) {
    let rt_out = runtime.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            rt_out.emit_debug("in", trimmed);
            let Ok(msg) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
                let params = msg.get("params").cloned().unwrap_or(json!({}));
                if let Some(id) = msg.get("id").cloned().filter(|v| !v.is_null()) {
                    let rt_req = rt_out.clone();
                    let m = method.to_string();
                    tokio::spawn(handle_agent_request(rt_req, id, m, params));
                } else if method == "session/update" {
                    let update = params.get("update").cloned().unwrap_or(json!({}));
                    (rt_out.hooks.emit)(json!({
                        "kind": "sessionUpdate",
                        "clientSessionId": rt_out.client_session_id,
                        "update": update,
                    }));
                }
            } else if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                let tx = {
                    let mut pending = rt_out.pending_rpc.lock().unwrap_or_else(|e| e.into_inner());
                    pending.remove(&id)
                };
                if let Some(tx) = tx {
                    if let Some(err) = msg.get("error") {
                        let message = err
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("ACP request failed")
                            .to_string();
                        let _ = tx.send(Err(message));
                    } else {
                        let _ = tx.send(Ok(msg.get("result").cloned().unwrap_or(json!({}))));
                    }
                }
            }
        }
        let code = {
            let mut child = rt_out.child.lock().await;
            child.try_wait().ok().flatten().and_then(|s| s.code())
        };
        {
            let mut pending = rt_out.pending_rpc.lock().unwrap_or_else(|e| e.into_inner());
            pending.clear();
        }
        (rt_out.hooks.emit)(json!({
            "kind": "exit",
            "clientSessionId": rt_out.client_session_id,
            "code": code,
        }));
    });

    let rt_err = runtime;
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if !line.trim().is_empty() {
                rt_err.emit_debug("stderr", &line);
            }
        }
    });
}

fn build_mcp_servers(hooks: &HostHooks, mcp_enabled: bool, cwd: &Path) -> Vec<Value> {
    if !mcp_enabled {
        return Vec::new();
    }
    let Some((command, script)) = &hooks.mcp_command else {
        return Vec::new();
    };
    if script.is_empty() {
        return Vec::new();
    }
    vec![json!({
        "name": "morrow",
        "command": command,
        "args": [script, "--vault", cwd.to_string_lossy()],
        "env": [],
    })]
}

fn extract_session_metadata(
    res: &Value,
) -> (Vec<Value>, Option<String>, Vec<Value>, Option<String>) {
    let modes_obj = res.get("modes");
    let modes = modes_obj
        .and_then(|m| m.get("availableModes"))
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    let current_mode = modes_obj
        .and_then(|m| m.get("currentModeId"))
        .and_then(|s| s.as_str())
        .map(String::from);

    let models_obj = res.get("models");
    let models = models_obj
        .and_then(|m| m.get("availableModels"))
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    let current_model = models_obj
        .and_then(|m| m.get("currentModelId"))
        .and_then(|s| s.as_str())
        .map(String::from);

    (modes, current_mode, models, current_model)
}

pub async fn start_or_load_session(params: StartSessionParams, hooks: Arc<HostHooks>) -> Value {
    let StartSessionParams {
        client_session_id,
        agent_id,
        existing_agent_session_id,
        cwd_override,
        mcp_enabled,
        auto_allow,
        system_notifications,
    } = params;
    let cfg = load_config();
    let spec = match resolve_agent_launch(&cfg, &agent_id) {
        Ok(s) => s,
        Err(error) => return json!({ "ok": false, "error": error }),
    };

    let cwd = cwd_override
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(vault::current)
        .unwrap_or_else(paths::documents_dir);

    if !cwd.is_dir() {
        return json!({
            "ok": false,
            "error": format!("Working directory does not exist: {}", cwd.display())
        });
    }

    // Close any prior runtime with the same client session id
    close_session(&client_session_id).await;

    let mut child = match spawn_agent_command(&spec, &cwd) {
        Ok(c) => c,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let Some(stdin) = child.stdin.take() else {
        return json!({ "ok": false, "error": "Agent stdin unavailable." });
    };
    let Some(stdout) = child.stdout.take() else {
        return json!({ "ok": false, "error": "Agent stdout unavailable." });
    };
    let Some(stderr) = child.stderr.take() else {
        return json!({ "ok": false, "error": "Agent stderr unavailable." });
    };

    let runtime = Arc::new(SessionRuntime {
        client_session_id: client_session_id.clone(),
        agent_session_id: Arc::new(Mutex::new(None)),
        cwd: cwd.clone(),
        wsl_mode: cfg!(windows) && spec.wsl_mode,
        stdin: Arc::new(AsyncMutex::new(stdin)),
        child: Arc::new(AsyncMutex::new(child)),
        pending_rpc: Arc::new(Mutex::new(HashMap::new())),
        terminals: Arc::new(Mutex::new(HashMap::new())),
        auto_allow: Arc::new(AtomicBool::new(auto_allow)),
        system_notifications: Arc::new(AtomicBool::new(system_notifications)),
        next_rpc_id: AtomicU64::new(1),
        hooks: hooks.clone(),
    });

    spawn_readers(runtime.clone(), stdout, stderr);

    let init_res = match runtime
        .send_request(
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": { "readTextFile": true, "writeTextFile": true },
                    "terminal": true
                },
                "clientInfo": {
                    "name": "morrow",
                    "title": "Morrow",
                    "version": env!("CARGO_PKG_VERSION"),
                }
            }),
        )
        .await
    {
        Ok(r) => r,
        Err(error) => {
            kill_runtime(&runtime).await;
            return json!({ "ok": false, "error": error });
        }
    };

    let agent_info = init_res.get("agentInfo");
    let agent_name = agent_info
        .and_then(|i| i.get("title").or_else(|| i.get("name")))
        .and_then(|s| s.as_str())
        .map(String::from);
    let agent_version = agent_info
        .and_then(|i| i.get("version"))
        .and_then(|s| s.as_str())
        .map(String::from);

    let acp_cwd = if runtime.wsl_mode {
        windows_path_to_wsl(&cwd)
    } else {
        cwd.to_string_lossy().into_owned()
    };
    let mcp_servers = build_mcp_servers(&hooks, mcp_enabled, &cwd);

    let session_res = if let Some(existing_id) = existing_agent_session_id {
        match runtime
            .send_request(
                "session/load",
                json!({
                    "sessionId": existing_id,
                    "cwd": acp_cwd,
                    "mcpServers": mcp_servers,
                }),
            )
            .await
        {
            Ok(mut res) => {
                if res.get("sessionId").is_none() {
                    res["sessionId"] = json!(existing_id);
                }
                Ok(res)
            }
            Err(_) => {
                runtime
                    .send_request(
                        "session/new",
                        json!({
                            "cwd": acp_cwd,
                            "mcpServers": mcp_servers,
                        }),
                    )
                    .await
            }
        }
    } else {
        runtime
            .send_request(
                "session/new",
                json!({
                    "cwd": acp_cwd,
                    "mcpServers": mcp_servers,
                }),
            )
            .await
    };

    let session_res = match session_res {
        Ok(r) => r,
        Err(error) => {
            kill_runtime(&runtime).await;
            return json!({ "ok": false, "error": error });
        }
    };

    let Some(agent_session_id) = session_res
        .get("sessionId")
        .and_then(|s| s.as_str())
        .map(String::from)
    else {
        kill_runtime(&runtime).await;
        return json!({ "ok": false, "error": "Agent did not return a sessionId." });
    };

    {
        let mut sid = runtime
            .agent_session_id
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *sid = Some(agent_session_id.clone());
    }

    {
        let mut sessions = sessions_map().lock().await;
        sessions.insert(client_session_id, runtime);
    }

    let (modes, current_mode_id, models, current_model_id) = extract_session_metadata(&session_res);
    json!({
        "ok": true,
        "agentSessionId": agent_session_id,
        "cwd": cwd.to_string_lossy(),
        "modes": modes,
        "currentModeId": current_mode_id,
        "models": models,
        "currentModelId": current_model_id,
        "agentName": agent_name,
        "agentVersion": agent_version,
    })
}

async fn get_runtime(client_session_id: &str) -> Option<Arc<SessionRuntime>> {
    let sessions = sessions_map().lock().await;
    sessions.get(client_session_id).cloned()
}

pub async fn prompt(
    client_session_id: String,
    prompt: Vec<Value>,
    auto_allow: bool,
    system_notifications: bool,
) -> Value {
    let Some(runtime) = get_runtime(&client_session_id).await else {
        return json!({ "ok": false, "error": "Agent session is not running." });
    };
    runtime.auto_allow.store(auto_allow, Ordering::SeqCst);
    runtime
        .system_notifications
        .store(system_notifications, Ordering::SeqCst);
    let agent_session_id = runtime
        .agent_session_id
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let Some(agent_session_id) = agent_session_id else {
        return json!({ "ok": false, "error": "Agent session has no sessionId." });
    };

    match runtime
        .send_request(
            "session/prompt",
            json!({
                "sessionId": agent_session_id,
                "prompt": prompt,
            }),
        )
        .await
    {
        Ok(res) => {
            let stop_reason = res
                .get("stopReason")
                .and_then(|s| s.as_str())
                .unwrap_or("end_turn");
            if runtime.system_notifications.load(Ordering::SeqCst) {
                (runtime.hooks.notify_if_unfocused)(
                    "Agent finished",
                    "Your agent response is ready.",
                );
            }
            json!({ "ok": true, "stopReason": stop_reason })
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

pub async fn cancel(client_session_id: &str) {
    if let Some(runtime) = get_runtime(client_session_id).await {
        let agent_session_id = runtime
            .agent_session_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(sid) = agent_session_id {
            let _ = runtime
                .send_notification("session/cancel", json!({ "sessionId": sid }))
                .await;
        }
    }
}

pub async fn set_mode(client_session_id: &str, mode_id: &str) -> Value {
    let Some(runtime) = get_runtime(client_session_id).await else {
        return json!({ "ok": false, "error": "Agent session is not running." });
    };
    let agent_session_id = runtime
        .agent_session_id
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let Some(sid) = agent_session_id else {
        return json!({ "ok": false, "error": "Missing agent sessionId." });
    };
    match runtime
        .send_request(
            "session/set_mode",
            json!({ "sessionId": sid, "modeId": mode_id }),
        )
        .await
    {
        Ok(_) => json!({ "ok": true }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

pub async fn set_model(client_session_id: &str, model_id: &str) -> Value {
    let Some(runtime) = get_runtime(client_session_id).await else {
        return json!({ "ok": false, "error": "Agent session is not running." });
    };
    let agent_session_id = runtime
        .agent_session_id
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let Some(sid) = agent_session_id else {
        return json!({ "ok": false, "error": "Missing agent sessionId." });
    };
    match runtime
        .send_request(
            "session/set_model",
            json!({ "sessionId": sid, "modelId": model_id }),
        )
        .await
    {
        Ok(_) => json!({ "ok": true }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

pub fn respond_permission(request_id: &str, option_id: Option<String>) {
    let tx = {
        let mut map = permissions_map().lock().unwrap_or_else(|e| e.into_inner());
        map.remove(request_id)
    };
    if let Some(tx) = tx {
        let _ = tx.send(option_id);
    }
}

async fn kill_runtime(runtime: &SessionRuntime) {
    let terminals: Vec<PendingTerminal> = {
        let mut map = runtime.terminals.lock().unwrap_or_else(|e| e.into_inner());
        map.drain().map(|(_, v)| v).collect()
    };
    for term in terminals {
        let mut guard = term.child.lock().await;
        if let Some(child) = guard.as_mut() {
            let _ = child.kill().await;
        }
    }
    let mut child = runtime.child.lock().await;
    let _ = child.kill().await;
}

pub async fn close_session(client_session_id: &str) {
    let removed = {
        let mut sessions = sessions_map().lock().await;
        sessions.remove(client_session_id)
    };
    if let Some(runtime) = removed {
        kill_runtime(&runtime).await;
    }
}

pub fn kill_all() {
    if let Some(sessions) = SESSIONS.get() {
        if let Ok(mut guard) = sessions.try_lock() {
            let runtimes: Vec<Arc<SessionRuntime>> = guard.drain().map(|(_, v)| v).collect();
            for runtime in runtimes {
                if let Ok(mut child) = runtime.child.try_lock() {
                    let _ = child.start_kill();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_list_contains_all_eleven_agents() {
        assert_eq!(PRESETS.len(), 11);
        let ids: Vec<&str> = PRESETS.iter().map(|p| p.id).collect();
        assert!(ids.contains(&"claude-code-acp"));
        assert!(ids.contains(&"codex-acp"));
        assert!(ids.contains(&"gemini-cli"));
        assert!(ids.contains(&"antigravity-cli"));
    }

    #[test]
    fn windows_path_translates_to_wsl() {
        assert_eq!(
            windows_path_to_wsl(Path::new(r"C:\Users\Dayle\Vault")),
            "/mnt/c/Users/Dayle/Vault"
        );
        assert_eq!(windows_path_to_wsl(Path::new(r"D:\")), "/mnt/d");
    }

    #[test]
    fn slice_lines_respects_one_based_line_and_limit() {
        let sample = "alpha\nbeta\ngamma\ndelta";
        assert_eq!(slice_lines(sample, Some(2), Some(2)), "beta\ngamma");
        assert_eq!(slice_lines(sample, Some(3), None), "gamma\ndelta");
        assert_eq!(slice_lines(sample, None, Some(2)), "alpha\nbeta");
    }

    #[test]
    fn build_wsl_command_quotes_args_and_env() {
        let mut env = HashMap::new();
        env.insert("API_KEY".to_string(), "sec'ret".to_string());
        let line =
            build_wsl_command_line("agy", &["acp".to_string(), "with space".to_string()], &env);
        assert!(line.contains("API_KEY='sec'\"'\"'ret'"));
        assert!(line.contains("exec 'agy' 'acp' 'with space'"));
    }
}
