// sync between your own computers on the same network: no server, no account, every request encrypted.
// the protocol is the one morrow 1.x spoke, so a computer still on 1.x syncs with one on 2.x
use crate::{paths, vault};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashMap;
use std::io::Read;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const PORT: u16 = 47610;
const DISCOVERY_PORT: u16 = 47611;
const BROADCAST_MS: u64 = 4000;
const ONLINE_MS: u64 = 15_000;
const MAX_SKEW_MS: u64 = 5 * 60 * 1000;
const PAIRING_MS: u64 = 10 * 60 * 1000;
const MAX_BODY: usize = 300 * 1024 * 1024;

#[derive(Clone)]
struct Peer {
    id: String,
    name: String,
    // base64 shared secret agreed when the two computers were paired
    secret: String,
    address: Option<String>,
    port: Option<u16>,
    last_sync: Option<u64>,
}

struct Config {
    device_id: String,
    name: String,
    enabled: bool,
    peers: Vec<Peer>,
}

struct Seen {
    address: String,
    port: u16,
    at: u64,
    // set while that computer is waiting to be paired
    pairing_name: Option<String>,
}

struct Pairing {
    code: String,
    key: [u8; 32],
    expires: u64,
    attempts: u32,
}

struct Services {
    server: Arc<tiny_http::Server>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
struct State {
    config: Option<Config>,
    seen: HashMap<String, Seen>,
    // when each paired computer last answered or asked something, networks that block broadcasts still work
    contact: HashMap<String, u64>,
    nonces: HashMap<String, u64>,
    pairing: Option<Pairing>,
    services: Option<Services>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
static LISTENING_PORT: AtomicU16 = AtomicU16::new(PORT);
static NOTIFY: Mutex<Option<Box<dyn Fn(Value) + Send>>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut State) -> T) -> T {
    let mut guard = STATE.lock().unwrap_or_else(|poison| poison.into_inner());
    let state = guard.get_or_insert_with(State::default);
    if state.config.is_none() {
        state.config = Some(load_config());
    }
    f(state)
}

fn notify(event: Value) {
    if let Some(callback) = NOTIFY.lock().ok().as_ref().and_then(|guard| guard.as_ref()) {
        callback(event);
    }
}

fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn host_name() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

fn config_file() -> std::path::PathBuf {
    paths::data_dir().join("sync.json")
}

fn load_config() -> Config {
    let raw = paths::read_json(&config_file()).unwrap_or(Value::Null);
    let peers = raw["peers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|peer| {
            let id = peer["id"].as_str().filter(|id| valid_id(id))?;
            Some(Peer {
                id: id.to_string(),
                name: peer["name"].as_str().unwrap_or("Computer").to_string(),
                secret: peer["secret"].as_str()?.to_string(),
                address: peer["address"].as_str().map(String::from),
                port: peer["port"].as_u64().map(|port| port as u16),
                last_sync: peer["lastSync"].as_u64(),
            })
        })
        .collect();
    Config {
        device_id: raw["deviceId"]
            .as_str()
            .filter(|id| valid_id(id))
            .map(String::from)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        name: raw["name"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .map(|name| name.chars().take(60).collect())
            .unwrap_or_else(host_name),
        enabled: raw["enabled"].as_bool() == Some(true),
        peers,
    }
}

fn save_config(config: &Config) {
    let peers: Vec<Value> = config
        .peers
        .iter()
        .map(|peer| {
            let mut value = json!({ "id": peer.id, "name": peer.name, "secret": peer.secret });
            if let Some(address) = &peer.address {
                value["address"] = json!(address);
            }
            if let Some(port) = peer.port {
                value["port"] = json!(port);
            }
            if let Some(at) = peer.last_sync {
                value["lastSync"] = json!(at);
            }
            value
        })
        .collect();
    let body = serde_json::to_vec_pretty(&json!({
        "deviceId": config.device_id,
        "name": config.name,
        "enabled": config.enabled,
        "peers": peers,
    }))
    .unwrap_or_default();
    let _ = paths::write_atomic_plain(&config_file(), &body);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(config_file(), std::fs::Permissions::from_mode(0o600));
    }
}

// ---- encryption: aes-256-gcm with a key only the two paired computers know

fn peer_key(device_id: &str, peer: &Peer) -> [u8; 32] {
    let mut ids = [device_id, peer.id.as_str()];
    ids.sort();
    let secret = B64.decode(&peer.secret).unwrap_or_default();
    let hk = hkdf::Hkdf::<Sha256>::new(Some(b"morrow-sync-v1"), &secret);
    let mut key = [0u8; 32];
    let _ = hk.expand(ids.join("|").as_bytes(), &mut key);
    key
}

fn pairing_key(code: &str, device_id: &str) -> [u8; 32] {
    let normal: String = code
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_uppercase() || ('2'..='7').contains(c))
        .collect();
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(normal.as_bytes(), format!("morrow-pair:{device_id}").as_bytes(), 200_000, &mut key);
    key
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

fn seal(key: &[u8; 32], payload: Value) -> Value {
    let iv = random_bytes::<12>();
    let body = json!({ "ts": paths::now_ms(), "nonce": B64.encode(random_bytes::<12>()), "payload": payload });
    let cipher = Aes256Gcm::new(key.into());
    // the tag comes after the text, as node writes it
    let data = cipher.encrypt(Nonce::from_slice(&iv), body.to_string().as_bytes()).unwrap_or_default();
    json!({ "iv": B64.encode(iv), "data": B64.encode(data) })
}

// fails when the message was not made with this key, is old, or was seen before
fn open(state: &mut State, key: &[u8; 32], envelope: &Value) -> Result<Value, String> {
    let iv = B64.decode(envelope["iv"].as_str().ok_or("Bad message.")?).map_err(|_| "Bad message.")?;
    let data = B64.decode(envelope["data"].as_str().ok_or("Bad message.")?).map_err(|_| "Bad message.")?;
    if iv.len() != 12 {
        return Err("Bad message.".into());
    }
    let cipher = Aes256Gcm::new(key.into());
    let text = cipher.decrypt(Nonce::from_slice(&iv), data.as_ref()).map_err(|_| "Bad message.")?;
    let message: Value = serde_json::from_slice(&text).map_err(|_| "Bad message.")?;
    let ts = message["ts"].as_f64().unwrap_or(0.0) as u64;
    let now = paths::now_ms();
    if now.abs_diff(ts) > MAX_SKEW_MS {
        return Err("Message too old, check both clocks.".into());
    }
    let nonce = message["nonce"].as_str().unwrap_or_default().to_string();
    if state.nonces.contains_key(&nonce) {
        return Err("Message replayed.".into());
    }
    state.nonces.insert(nonce, now);
    state.nonces.retain(|_, at| now - *at <= MAX_SKEW_MS * 2);
    Ok(message["payload"].clone())
}

// ---- the server other paired computers talk to

fn reply(request: tiny_http::Request, status: u16, body: Value) {
    let header = tiny_http::Header::from_bytes("Content-Type", "application/json").expect("valid header");
    let response = tiny_http::Response::from_string(body.to_string()).with_status_code(status).with_header(header);
    let _ = request.respond(response);
}

fn handle(mut request: tiny_http::Request) {
    let method = request.method().as_str().to_string();
    let url = request.url().to_string();
    let address = request.remote_addr().map(|addr| match addr {
        SocketAddr::V4(v4) => v4.ip().to_string(),
        SocketAddr::V6(v6) => v6.ip().to_ipv4_mapped().map(|ip| ip.to_string()).unwrap_or_else(|| v6.ip().to_string()),
    });
    if method == "GET" && url == "/morrow/v1/id" {
        // only says who it is while it is waiting to be paired
        let answer = with(|state| {
            let config = state.config.as_ref()?;
            state.pairing.as_ref()?;
            Some(json!({ "id": config.device_id, "name": config.name }))
        });
        return match answer {
            Some(body) => reply(request, 200, body),
            None => reply(request, 404, json!({})),
        };
    }
    if method != "POST" || url != "/morrow/v1" {
        return reply(request, 404, json!({}));
    }
    let mut raw = Vec::new();
    if request.as_reader().take(MAX_BODY as u64 + 1).read_to_end(&mut raw).is_err() || raw.len() > MAX_BODY {
        return reply(request, 400, json!({}));
    }
    let Ok(body) = serde_json::from_slice::<Value>(&raw) else {
        return reply(request, 400, json!({}));
    };

    if body["pair"] == json!(true) {
        let (status, answer, paired) = with(|state| pair_request(state, &body, address.clone()));
        if let Some((id, name)) = paired {
            notify(json!({ "type": "paired", "peerId": id, "name": name }));
        }
        return reply(request, status, answer);
    }

    let opened = with(|state| {
        let config = state.config.as_ref()?;
        if !config.enabled {
            return None;
        }
        let peer = config.peers.iter().find(|peer| Some(peer.id.as_str()) == body["from"].as_str())?.clone();
        let key = peer_key(&config.device_id, &peer);
        let payload = open(state, &key, &body).ok()?;
        // the address the request came from, and the port the other computer listens on
        let config = state.config.as_mut()?;
        if let Some(stored) = config.peers.iter_mut().find(|item| item.id == peer.id) {
            if let Some(address) = &address {
                stored.address = Some(address.clone());
            }
            if let Some(port) = payload["port"].as_u64().filter(|port| (1..65536).contains(port)) {
                stored.port = Some(port as u16);
            }
        }
        let info = (config.device_id.clone(), config.name.clone());
        state.contact.insert(peer.id.clone(), paths::now_ms());
        Some((peer, key, payload, info))
    });
    let Some((peer, key, payload, (device_id, name))) = opened else {
        return reply(request, 403, json!({}));
    };
    let answer = (|| -> Result<Value, String> {
        let op = payload["op"].as_str().unwrap_or_default();
        Ok(match op {
            "hello" => {
                let vault = vault::current().and_then(|_| vault::identity().ok());
                json!({
                    "deviceId": device_id,
                    "name": name,
                    "vaultId": vault.as_ref().map(|v| v["id"].clone()),
                    "vaultName": vault.as_ref().map(|v| v["name"].clone()),
                })
            }
            "manifest" => {
                let vault = vault::identity()?;
                if payload["vaultId"] != vault["id"] {
                    json!({ "error": "different vault" })
                } else {
                    json!({ "manifest": vault::manifest()? })
                }
            }
            "get" => {
                let vault = vault::identity()?;
                match payload["path"].as_str() {
                    Some(path) if payload["vaultId"] == vault["id"] && vault::is_synced_path(path) => {
                        json!({ "data": vault::synced_file_base64(path) })
                    }
                    _ => json!({ "error": "not allowed" }),
                }
            }
            "pull" => {
                // the other computer has changes, this one fetches them
                notify(json!({ "type": "pull-requested", "peerId": peer.id }));
                json!({ "ok": true })
            }
            _ => json!({ "error": "unknown" }),
        })
    })()
    .unwrap_or_else(|error| json!({ "error": error }));
    reply(request, 200, seal(&key, answer));
}

fn pair_request(state: &mut State, body: &Value, address: Option<String>) -> (u16, Value, Option<(String, String)>) {
    let now = paths::now_ms();
    let Some(pairing) = state.pairing.as_mut().filter(|pairing| now <= pairing.expires) else {
        return (403, json!({ "error": "This computer is not waiting to pair." }), None);
    };
    pairing.attempts += 1;
    if pairing.attempts > 5 {
        state.pairing = None;
        return (403, json!({ "error": "Too many tries, start pairing again." }), None);
    }
    let key = pairing.key;
    let Ok(payload) = open(state, &key, body) else {
        return (403, json!({ "error": "That code is not right." }), None);
    };
    let (Some(device_id), Some(secret)) = (payload["deviceId"].as_str(), payload["secret"].as_str()) else {
        return (403, json!({ "error": "That code is not right." }), None);
    };
    if !valid_id(device_id) {
        return (403, json!({ "error": "That code is not right." }), None);
    }
    let peer = Peer {
        id: device_id.to_string(),
        name: payload["name"].as_str().map(|name| name.chars().take(60).collect()).unwrap_or_else(|| "Computer".into()),
        secret: secret.to_string(),
        address,
        port: payload["port"].as_u64().map(|port| port as u16),
        last_sync: None,
    };
    state.contact.insert(peer.id.clone(), now);
    state.pairing = None;
    let Some(config) = state.config.as_mut() else {
        return (500, json!({}), None);
    };
    config.peers.retain(|item| item.id != peer.id);
    config.peers.push(peer.clone());
    save_config(config);
    let answer = seal(&key, json!({ "deviceId": config.device_id, "name": config.name }));
    (200, answer, Some((peer.id, peer.name)))
}

// ---- finding each other on the network

fn broadcast_addresses() -> Vec<String> {
    let mut result = vec!["255.255.255.255".to_string()];
    for interface in if_addrs::get_if_addrs().unwrap_or_default() {
        if interface.is_loopback() {
            continue;
        }
        if let if_addrs::IfAddr::V4(v4) = interface.addr {
            let ip = u32::from(v4.ip);
            let mask = u32::from(v4.netmask);
            let address = std::net::Ipv4Addr::from(ip | !mask).to_string();
            if !result.contains(&address) {
                result.push(address);
            }
        }
    }
    result
}

fn announce(socket: &UdpSocket) {
    // a name is only shared while this computer is waiting to be paired
    let message = with(|state| {
        let config = state.config.as_ref()?;
        Some(json!({
            "app": "morrow-sync",
            "v": 1,
            "id": config.device_id,
            "port": LISTENING_PORT.load(Ordering::Relaxed),
            "pairing": state.pairing.as_ref().map(|_| config.name.clone()),
        }))
    });
    let Some(message) = message else { return };
    let bytes = message.to_string();
    for address in broadcast_addresses() {
        let _ = socket.send_to(bytes.as_bytes(), (address.as_str(), DISCOVERY_PORT));
    }
}

fn discovery_socket() -> Option<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).ok()?;
    socket.set_reuse_address(true).ok()?;
    #[cfg(all(unix, not(target_os = "solaris")))]
    let _ = socket.set_reuse_port(true);
    socket.set_broadcast(true).ok()?;
    let address: SocketAddr = ([0, 0, 0, 0], DISCOVERY_PORT).into();
    socket.bind(&address.into()).ok()?;
    let socket: UdpSocket = socket.into();
    socket.set_read_timeout(Some(Duration::from_millis(500))).ok()?;
    Some(socket)
}

fn start_services(state: &mut State) {
    if state.services.is_some() {
        return;
    }
    let mut server = None;
    for port in [PORT, PORT + 2, PORT + 3, 0] {
        if let Ok(candidate) = tiny_http::Server::http(("0.0.0.0", port)) {
            let actual = candidate.server_addr().to_ip().map(|addr| addr.port()).unwrap_or(port);
            LISTENING_PORT.store(actual, Ordering::Relaxed);
            server = Some(Arc::new(candidate));
            break;
        }
    }
    let Some(server) = server else { return };
    let stop = Arc::new(AtomicBool::new(false));
    let serving = server.clone();
    std::thread::spawn(move || {
        for request in serving.incoming_requests() {
            std::thread::spawn(move || handle(request));
        }
    });
    let stopping = stop.clone();
    std::thread::spawn(move || {
        let Some(socket) = discovery_socket() else { return };
        let mut last = 0u64;
        let mut buffer = [0u8; 2048];
        while !stopping.load(Ordering::Relaxed) {
            if paths::now_ms() - last >= BROADCAST_MS {
                announce(&socket);
                last = paths::now_ms();
            }
            let Ok((size, from)) = socket.recv_from(&mut buffer) else { continue };
            let Ok(message) = serde_json::from_slice::<Value>(&buffer[..size]) else { continue };
            let Some(id) = message["id"].as_str().filter(|id| valid_id(id)) else { continue };
            if message["app"] != "morrow-sync" {
                continue;
            }
            with(|state| {
                if state.config.as_ref().map(|config| config.device_id.as_str()) == Some(id) {
                    return;
                }
                state.seen.insert(
                    id.to_string(),
                    Seen {
                        address: from.ip().to_string(),
                        port: message["port"].as_u64().map(|port| port as u16).unwrap_or(PORT),
                        at: paths::now_ms(),
                        pairing_name: message["pairing"].as_str().map(|name| name.chars().take(60).collect()),
                    },
                );
            });
        }
    });
    state.services = Some(Services { server, stop });
}

fn stop_services(state: &mut State) {
    if let Some(services) = state.services.take() {
        services.stop.store(true, Ordering::Relaxed);
        services.server.unblock();
    }
}

fn refresh(state: &mut State) {
    let enabled = state.config.as_ref().is_some_and(|config| config.enabled);
    if enabled || state.pairing.is_some() {
        start_services(state);
    } else {
        stop_services(state);
    }
}

// ---- what the app asks for

pub fn init(on_event: impl Fn(Value) + Send + 'static) {
    if let Ok(mut guard) = NOTIFY.lock() {
        *guard = Some(Box::new(on_event));
    }
    with(refresh);
}

pub fn close() {
    with(stop_services);
}

pub fn status() -> Value {
    with(|state| {
        let now = paths::now_ms();
        let config = state.config.as_ref().expect("loaded");
        let peers: Vec<Value> = config
            .peers
            .iter()
            .map(|peer| {
                let seen = state.seen.get(&peer.id).filter(|seen| now - seen.at < ONLINE_MS);
                let recent = state.contact.get(&peer.id).is_some_and(|at| *at > now.saturating_sub(3 * 60 * 1000));
                json!({
                    "id": peer.id,
                    "name": peer.name,
                    "online": seen.is_some() || recent,
                    // worth trying even when broadcasts do not get through, as long as it was reached before
                    "reachable": seen.is_some() || peer.address.is_some(),
                    "lastSync": peer.last_sync,
                })
            })
            .collect();
        let waiting: Vec<Value> = state
            .seen
            .iter()
            .filter(|(id, seen)| {
                seen.pairing_name.is_some() && now - seen.at < ONLINE_MS && !config.peers.iter().any(|peer| &peer.id == *id)
            })
            .map(|(id, seen)| json!({ "id": id, "name": seen.pairing_name, "address": seen.address, "port": seen.port }))
            .collect();
        json!({
            "enabled": config.enabled,
            "name": config.name,
            "deviceId": config.device_id,
            "pairingCode": state.pairing.as_ref().filter(|pairing| pairing.expires > now).map(|pairing| pairing.code.clone()),
            "peers": peers,
            "waiting": waiting,
        })
    })
}

pub fn set_enabled(enabled: bool) {
    with(|state| {
        if let Some(config) = state.config.as_mut() {
            config.enabled = enabled;
            save_config(config);
        }
        refresh(state);
    });
}

pub fn set_name(name: &str) {
    let clean: String = name.trim().chars().take(60).collect();
    if clean.is_empty() {
        return;
    }
    with(|state| {
        if let Some(config) = state.config.as_mut() {
            config.name = clean;
            save_config(config);
        }
    });
}

// shows a code the other computer types in, valid for ten minutes
pub fn start_pairing() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let raw: Vec<char> = random_bytes::<16>().iter().map(|byte| ALPHABET[(*byte % 32) as usize] as char).collect();
    let code = raw.chunks(4).map(|chunk| chunk.iter().collect::<String>()).collect::<Vec<_>>().join("-");
    with(|state| {
        let device_id = state.config.as_ref().map(|config| config.device_id.clone()).unwrap_or_default();
        state.pairing = Some(Pairing {
            code: code.clone(),
            key: pairing_key(&code, &device_id),
            expires: paths::now_ms() + PAIRING_MS,
            attempts: 0,
        });
        refresh(state);
    });
    code
}

pub fn stop_pairing() {
    with(|state| {
        state.pairing = None;
        refresh(state);
    });
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap_or_default()
}

pub async fn pair(target: Value, code: String) -> Value {
    match pair_inner(target, code).await {
        Ok(name) => json!({ "ok": true, "name": name }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

async fn pair_inner(target: Value, code: String) -> Result<String, String> {
    let address = target["address"].as_str().ok_or("Pairing failed.")?.to_string();
    let port = target["port"].as_u64().map(|port| port as u16).unwrap_or(PORT);
    let client = http();
    let mut id = target["id"].as_str().map(String::from);
    if id.is_none() {
        let answer = client
            .get(format!("http://{address}:{port}/morrow/v1/id"))
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !answer.status().is_success() {
            return Err("That computer is not waiting to pair.".into());
        }
        id = answer.json::<Value>().await.ok().and_then(|body| body["id"].as_str().map(String::from));
    }
    let id = id.filter(|id| valid_id(id)).ok_or("That computer did not answer.")?;
    // this computer starts listening first, so the other one learns where to reach it
    let (device_id, name) = with(|state| {
        let config = state.config.as_mut().expect("loaded");
        config.enabled = true;
        save_config(config);
        let info = (config.device_id.clone(), config.name.clone());
        refresh(state);
        info
    });
    let key = pairing_key(&code, &id);
    let secret = B64.encode(random_bytes::<32>());
    let mut body = seal(
        &key,
        json!({ "deviceId": device_id, "name": name, "secret": secret, "port": LISTENING_PORT.load(Ordering::Relaxed) }),
    );
    body["pair"] = json!(true);
    let response = client
        .post(format!("http://{address}:{port}/morrow/v1"))
        .json(&body)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let ok = response.status().is_success();
    let answer: Value = response.json().await.unwrap_or(Value::Null);
    if !ok {
        return Err(answer["error"].as_str().unwrap_or("Pairing failed.").to_string());
    }
    with(|state| {
        let other = open(state, &key, &answer)?;
        if other["deviceId"].as_str() != Some(id.as_str()) {
            return Err("Pairing failed.".to_string());
        }
        let other_name = other["name"].as_str().unwrap_or("Computer").to_string();
        let config = state.config.as_mut().expect("loaded");
        config.peers.retain(|peer| peer.id != id);
        config.peers.push(Peer {
            id: id.clone(),
            name: other_name.clone(),
            secret: secret.clone(),
            address: Some(address.clone()),
            port: Some(port),
            last_sync: None,
        });
        save_config(config);
        state.contact.insert(id.clone(), paths::now_ms());
        Ok(other_name)
    })
}

pub fn forget(id: &str) {
    with(|state| {
        if let Some(config) = state.config.as_mut() {
            config.peers.retain(|peer| peer.id != id);
            save_config(config);
        }
    });
}

// one encrypted request to a paired computer
pub async fn request(peer_id: String, mut payload: Value) -> Result<Value, String> {
    let (peer, key, device_id, address, port) = with(|state| {
        let config = state.config.as_ref().expect("loaded");
        let peer = config.peers.iter().find(|peer| peer.id == peer_id).cloned().ok_or("That computer is not paired.")?;
        let seen = state.seen.get(&peer.id);
        let address = seen
            .map(|seen| seen.address.clone())
            .or_else(|| peer.address.clone())
            .ok_or_else(|| format!("{} has not been seen on this network.", peer.name))?;
        let port = seen.map(|seen| seen.port).or(peer.port).unwrap_or(PORT);
        Ok::<_, String>((peer.clone(), peer_key(&config.device_id, &peer), config.device_id.clone(), address, port))
    })?;
    let timeout = Duration::from_secs(if payload["op"] == "get" { 120 } else { 30 });
    payload["port"] = json!(LISTENING_PORT.load(Ordering::Relaxed));
    let mut body = seal(&key, payload);
    body["from"] = json!(device_id);
    let response = http()
        .post(format!("http://{address}:{port}/morrow/v1"))
        .json(&body)
        .timeout(timeout)
        .send()
        .await
        .map_err(|_| format!("{} did not answer. Is it on the same network?", peer.name))?;
    if !response.status().is_success() {
        return Err(format!("{} refused the request. Is sync turned on there?", peer.name));
    }
    let answer: Value = response.json().await.map_err(|error| error.to_string())?;
    with(|state| {
        let result = open(state, &key, &answer)?;
        state.contact.insert(peer.id.clone(), paths::now_ms());
        if let Some(config) = state.config.as_mut() {
            if let Some(stored) = config.peers.iter_mut().find(|item| item.id == peer.id) {
                if stored.address.as_deref() != Some(address.as_str()) || stored.port != Some(port) {
                    stored.address = Some(address.clone());
                    stored.port = Some(port);
                    save_config(config);
                }
            }
        }
        Ok(result)
    })
}

pub fn mark(peer_id: &str) {
    let found = with(|state| {
        let config = state.config.as_mut()?;
        let peer = config.peers.iter_mut().find(|peer| peer.id == peer_id)?;
        peer.last_sync = Some(paths::now_ms());
        save_config(config);
        Some(())
    });
    if found.is_some() {
        notify(json!({ "type": "changed" }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_messages_open_once() {
        let key = pairing_key("ABCD-EFGH-2345-6723", "device-one");
        let mut state = State::default();
        let sealed = seal(&key, json!({ "op": "hello" }));
        assert_eq!(open(&mut state, &key, &sealed).unwrap()["op"], "hello");
        assert!(open(&mut state, &key, &sealed).is_err());
        let other = pairing_key("ZZZZ-EFGH-2345-6723", "device-one");
        assert!(open(&mut state, &other, &seal(&key, json!(1))).is_err());
    }

    #[test]
    fn peer_keys_match_on_both_sides() {
        let secret = B64.encode([7u8; 32]);
        let a = Peer { id: "device-bbbb".into(), name: String::new(), secret: secret.clone(), address: None, port: None, last_sync: None };
        let b = Peer { id: "device-aaaa".into(), ..a.clone() };
        assert_eq!(peer_key("device-aaaa", &a), peer_key("device-bbbb", &b));
    }
}
