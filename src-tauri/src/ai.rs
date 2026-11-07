// the optional assistant: off until someone adds their own key. the key stays in this process and the
// system keychain, the page only ever sees the conversation
use crate::paths;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::oneshot;

const MAX_TOKENS: u64 = 16000;
const ANTHROPIC: &str = "https://api.anthropic.com/v1";
const KEYCHAIN_SERVICE: &str = "Morrow";
const KEYCHAIN_USER: &str = "assistant";

struct Provider {
    id: &'static str,
    label: &'static str,
    // an openai compatible endpoint, empty for claude which has its own api
    base_url: &'static str,
    needs_key: bool,
    default_model: &'static str,
    key_url: &'static str,
}

const PROVIDERS: [Provider; 5] = [
    Provider {
        id: "anthropic",
        label: "Claude",
        base_url: "",
        needs_key: true,
        default_model: "claude-opus-5-5",
        key_url: "https://console.anthropic.com/settings/keys",
    },
    Provider {
        id: "openai",
        label: "ChatGPT",
        base_url: "https://api.openai.com/v1",
        needs_key: true,
        default_model: "",
        key_url: "https://platform.openai.com/api-keys",
    },
    Provider {
        id: "gemini",
        label: "Gemini",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        needs_key: true,
        default_model: "",
        key_url: "https://aistudio.google.com/apikey",
    },
    Provider {
        id: "openrouter",
        label: "OpenRouter",
        base_url: "https://openrouter.ai/api/v1",
        needs_key: true,
        default_model: "",
        key_url: "https://openrouter.ai/keys",
    },
    Provider {
        id: "custom",
        label: "Other",
        base_url: "http://localhost:11434/v1",
        needs_key: false,
        default_model: "",
        key_url: "",
    },
];

fn provider_of(id: &str) -> &'static Provider {
    PROVIDERS.iter().find(|provider| provider.id == id).unwrap_or(&PROVIDERS[0])
}

#[derive(Clone)]
struct Stored {
    provider: String,
    model: String,
    base_url: String,
}

struct State {
    stored: Option<Stored>,
    // the key read from the keychain, or the only copy when there is no keychain
    key: Option<Option<String>>,
    keychain: Option<bool>,
}

static STATE: Mutex<State> = Mutex::new(State { stored: None, key: None, keychain: None });
static RUNNING: Mutex<Option<HashMap<String, oneshot::Sender<()>>>> = Mutex::new(None);

fn settings_file() -> PathBuf {
    paths::data_dir().join("assistant.json")
}

fn entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).ok()
}

// a keychain counts when it answers, even to say there is no key in it yet
fn keychain_works(state: &mut State) -> bool {
    *state.keychain.get_or_insert_with(|| {
        entry().is_some_and(|entry| matches!(entry.get_password(), Ok(_) | Err(keyring::Error::NoEntry)))
    })
}

fn load(state: &mut State) -> Stored {
    if let Some(stored) = &state.stored {
        return stored.clone();
    }
    let raw = paths::read_json(&settings_file()).unwrap_or(Value::Null);
    let provider = provider_of(raw["provider"].as_str().unwrap_or("anthropic"));
    let stored = Stored {
        provider: provider.id.to_string(),
        model: raw["model"].as_str().unwrap_or(provider.default_model).to_string(),
        base_url: raw["baseUrl"].as_str().unwrap_or(provider.base_url).to_string(),
    };
    state.stored = Some(stored.clone());
    stored
}

fn save(state: &mut State, stored: Stored) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(&json!({
        "provider": stored.provider,
        "model": stored.model,
        "baseUrl": stored.base_url,
    }))
    .map_err(|error| error.to_string())?;
    state.stored = Some(stored);
    let file = settings_file();
    paths::write_atomic_plain(&file, &body).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn read_key(state: &mut State) -> Option<String> {
    if let Some(key) = &state.key {
        return key.clone();
    }
    let key = if keychain_works(state) { entry().and_then(|entry| entry.get_password().ok()) } else { None };
    state.key = Some(key.clone());
    key
}

fn public_settings(state: &mut State) -> Value {
    let stored = load(state);
    let has_key = read_key(state).is_some();
    let providers: Vec<Value> = PROVIDERS
        .iter()
        .map(|provider| {
            json!({
                "id": provider.id,
                "label": provider.label,
                "baseUrl": provider.base_url,
                "needsKey": provider.needs_key,
                "defaultModel": provider.default_model,
                "keyUrl": provider.key_url,
            })
        })
        .collect();
    json!({
        "provider": stored.provider,
        "model": stored.model,
        "baseUrl": stored.base_url,
        "hasKey": has_key,
        "keyStorage": if keychain_works(state) { "system" } else { "session" },
        "providers": providers,
    })
}

pub fn settings() -> Value {
    let mut state = STATE.lock().unwrap_or_else(|poison| poison.into_inner());
    public_settings(&mut state)
}

fn set_key(state: &mut State, key: Option<String>) {
    if keychain_works(state) {
        if let Some(entry) = entry() {
            let _ = match &key {
                Some(key) => entry.set_password(key),
                None => entry.delete_credential(),
            };
        }
    }
    state.key = Some(key);
}

// a key of null removes it, a missing key keeps the one there is, changing provider forgets it
pub fn configure(patch: Value) -> Result<Value, String> {
    let mut state = STATE.lock().unwrap_or_else(|poison| poison.into_inner());
    let current = load(&mut state);
    let mut next = current.clone();
    if let Some(id) = patch["provider"].as_str().filter(|id| *id != current.provider) {
        let provider = provider_of(id);
        next.provider = provider.id.into();
        next.model = provider.default_model.into();
        next.base_url = provider.base_url.into();
        set_key(&mut state, None);
    }
    if let Some(model) = patch["model"].as_str() {
        next.model = model.trim().chars().take(200).collect();
    }
    if let Some(url) = patch["baseUrl"].as_str() {
        next.base_url = url.trim().trim_end_matches('/').chars().take(500).collect();
    }
    match patch.get("key") {
        Some(Value::Null) => set_key(&mut state, None),
        Some(Value::String(key)) if !key.trim().is_empty() => set_key(&mut state, Some(key.trim().to_string())),
        _ => {}
    }
    save(&mut state, next)?;
    Ok(public_settings(&mut state))
}

fn snapshot() -> (Stored, Option<String>) {
    let mut state = STATE.lock().unwrap_or_else(|poison| poison.into_inner());
    let stored = load(&mut state);
    let key = read_key(&mut state);
    (stored, key)
}

// requests to a model on this computer can take many minutes to start answering, so nothing times out
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Morrow/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

fn describe_error(error: &reqwest::Error, local: bool) -> String {
    let mut reason = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(inner) = source {
        reason.push(' ');
        reason.push_str(&inner.to_string());
        source = inner.source();
    }
    let lower = reason.to_lowercase();
    if lower.contains("dns") || lower.contains("lookup") || lower.contains("resolve") {
        return "Could not reach the service. Are you online?".into();
    }
    if error.is_connect() || lower.contains("refused") {
        return if local {
            "Could not reach the model. Check that it is running and the address in Settings is right.".into()
        } else {
            "Could not reach the service. Are you online?".into()
        };
    }
    if lower.contains("reset") || lower.contains("closed") || lower.contains("incomplete") || error.is_body() {
        return "The model stopped before answering. It may have run out of memory, try a smaller model.".into();
    }
    reason
}

async fn http_error(response: reqwest::Response) -> String {
    let status = response.status().as_u16();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let detail = match &body["error"] {
        Value::String(text) => text.clone(),
        error => error["message"].as_str().or(body["message"].as_str()).unwrap_or_default().to_string(),
    };
    match status {
        401 => "The API key was not accepted.".into(),
        403 => "This API key is not allowed to use that model.".into(),
        404 => "That model was not found. Pick another one in Settings.".into(),
        429 => "Too many requests for now, try again in a moment.".into(),
        _ if detail.is_empty() => format!("The service returned an error ({status})."),
        _ => format!("The service returned an error ({status}): {detail}"),
    }
}

fn anthropic(request: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    request.header("x-api-key", key).header("anthropic-version", "2023-06-01")
}

pub async fn models() -> Value {
    let (stored, key) = snapshot();
    let provider = provider_of(&stored.provider);
    if provider.needs_key && key.is_none() {
        return json!({ "ok": false, "models": [], "error": "Add an API key first." });
    }
    let client = client();
    let local = provider.id == "custom";
    let mut models: Vec<String> = Vec::new();
    if provider.id == "anthropic" {
        let key = key.unwrap_or_default();
        let mut after: Option<String> = None;
        loop {
            let mut url = format!("{ANTHROPIC}/models?limit=1000");
            if let Some(after) = &after {
                url.push_str(&format!("&after_id={after}"));
            }
            let response = match anthropic(client.get(url), &key).send().await {
                Ok(response) => response,
                Err(error) => return json!({ "ok": false, "models": [], "error": describe_error(&error, false) }),
            };
            if !response.status().is_success() {
                return json!({ "ok": false, "models": [], "error": http_error(response).await });
            }
            let page: Value = response.json().await.unwrap_or(Value::Null);
            for item in page["data"].as_array().into_iter().flatten() {
                if let Some(id) = item["id"].as_str() {
                    models.push(id.to_string());
                }
            }
            match (page["has_more"].as_bool(), page["last_id"].as_str()) {
                (Some(true), Some(last)) => after = Some(last.to_string()),
                _ => break,
            }
        }
        return json!({ "ok": true, "models": models });
    }
    let mut request = client.get(format!("{}/models", stored.base_url));
    if let Some(key) = &key {
        request = request.bearer_auth(key);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => return json!({ "ok": false, "models": [], "error": describe_error(&error, local) }),
    };
    if !response.status().is_success() {
        return json!({ "ok": false, "models": [], "error": http_error(response).await });
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let skip = [
        "embed", "tts", "whisper", "dall-e", "moderation", "transcribe", "image", "audio", "realtime", "imagen",
        "veo",
    ];
    // only models that chat, not the ones for pictures, speech or embeddings
    for item in body["data"].as_array().into_iter().flatten() {
        let id = match &item["id"] {
            Value::String(id) => id.trim_start_matches("models/").to_string(),
            other => other.to_string(),
        };
        let lower = id.to_lowercase();
        if !id.is_empty() && !skip.iter().any(|word| lower.contains(word)) {
            models.push(id);
        }
    }
    models.sort();
    json!({ "ok": true, "models": models })
}

pub fn cancel(id: &str) {
    if let Some(sender) = RUNNING.lock().ok().and_then(|mut running| running.as_mut()?.remove(id)) {
        let _ = sender.send(());
    }
}

// one reply from the model: the new input is added to the history, the reply comes back with it
pub async fn turn(request: Value) -> Value {
    let (stored, key) = snapshot();
    let provider = provider_of(&stored.provider);
    if provider.needs_key && key.is_none() {
        return json!({ "ok": false, "error": "Add an API key in Settings first." });
    }
    if stored.model.is_empty() {
        return json!({ "ok": false, "error": "Choose a model in Settings first." });
    }
    let id = request["id"].as_str().unwrap_or_default().to_string();
    let (stop, stopped) = oneshot::channel();
    if let Ok(mut running) = RUNNING.lock() {
        running.get_or_insert_with(HashMap::new).insert(id.clone(), stop);
    }
    let work = async {
        if provider.id == "anthropic" {
            claude_turn(&request, &stored, key.as_deref().unwrap_or_default()).await
        } else {
            compatible_turn(&request, &stored, key.as_deref()).await
        }
    };
    let result = tokio::select! {
        result = work => result.unwrap_or_else(|error| json!({ "ok": false, "error": error })),
        _ = stopped => json!({ "ok": false, "error": "Stopped." }),
    };
    if let Ok(mut running) = RUNNING.lock() {
        running.get_or_insert_with(HashMap::new).remove(&id);
    }
    result
}

async fn claude_turn(request: &Value, stored: &Stored, key: &str) -> Result<Value, String> {
    let mut history = request["history"].as_array().cloned().unwrap_or_default();
    let add = &request["add"];
    if add["kind"] == "user" {
        history.push(json!({ "role": "user", "content": add["text"] }));
    } else {
        let mut content: Vec<Value> = add["results"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|result| {
                let mut block = json!({
                    "type": "tool_result",
                    "tool_use_id": result["id"],
                    "content": result["content"],
                });
                if result["isError"].as_bool() == Some(true) {
                    block["is_error"] = json!(true);
                }
                block
            })
            .collect();
        if let Some(text) = add["text"].as_str().filter(|text| !text.is_empty()) {
            content.push(json!({ "type": "text", "text": text }));
        }
        history.push(json!({ "role": "user", "content": content }));
    }
    let tools: Vec<Value> = request["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|tool| json!({ "name": tool["name"], "description": tool["description"], "input_schema": tool["parameters"] }))
        .collect();
    let body = json!({
        "model": stored.model,
        "max_tokens": MAX_TOKENS,
        "system": request["system"],
        "tools": tools,
        "messages": history,
        // the rules and tools stay the same all conversation, so they are read from the cache after the first turn
        "cache_control": { "type": "ephemeral" },
        // a declined request is answered by the model anthropic recommends for it instead of stopping
        "fallbacks": "default",
    });
    let response = anthropic(client().post(format!("{ANTHROPIC}/messages?beta=true")), key)
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .json(&body)
        .send()
        .await
        .map_err(|error| describe_error(&error, false))?;
    if !response.status().is_success() {
        return Err(http_error(response).await);
    }
    let reply: Value = response.json().await.map_err(|error| describe_error(&error, false))?;
    let content = reply["content"].as_array().cloned().unwrap_or_default();
    // the whole reply goes back next time, as it came, so nothing the model needs is lost
    history.push(json!({ "role": "assistant", "content": content }));
    let text = content
        .iter()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let tool_calls: Vec<Value> = content
        .iter()
        .filter(|block| block["type"] == "tool_use")
        .map(|block| {
            json!({
                "id": block["id"],
                "name": block["name"],
                "input": if block["input"].is_object() { block["input"].clone() } else { json!({}) },
            })
        })
        .collect();
    let model = reply["model"].as_str().unwrap_or(&stored.model).to_string();
    let reason = reply["stop_reason"].as_str().unwrap_or_default();
    if reason == "refusal" {
        let explanation = reply["stop_details"]["explanation"].as_str().unwrap_or("The model declined to answer this.");
        return Ok(json!({
            "ok": true,
            "history": history,
            "text": if text.is_empty() { explanation.to_string() } else { text },
            "toolCalls": [],
            "stop": "refusal",
            "model": model,
        }));
    }
    let stop = if reason == "max_tokens" {
        "length"
    } else if !tool_calls.is_empty() && reason == "tool_use" {
        "tools"
    } else {
        "done"
    };
    Ok(json!({ "ok": true, "history": history, "text": text, "toolCalls": tool_calls, "stop": stop, "model": model }))
}

fn parse_arguments(raw: Option<&str>) -> Value {
    match raw {
        None | Some("") => json!({}),
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(value) if value.is_object() => value,
            Ok(_) => json!({}),
            Err(_) => json!({ "__invalid": raw }),
        },
    }
}

async fn compatible_turn(request: &Value, stored: &Stored, key: Option<&str>) -> Result<Value, String> {
    let mut history = request["history"].as_array().cloned().unwrap_or_default();
    let add = &request["add"];
    if add["kind"] == "user" {
        history.push(json!({ "role": "user", "content": add["text"] }));
    } else {
        for result in add["results"].as_array().into_iter().flatten() {
            let content = result["content"].as_str().unwrap_or_default();
            history.push(json!({
                "role": "tool",
                "tool_call_id": result["id"],
                "content": if result["isError"].as_bool() == Some(true) { format!("Error: {content}") } else { content.to_string() },
            }));
        }
        if let Some(text) = add["text"].as_str().filter(|text| !text.is_empty()) {
            history.push(json!({ "role": "user", "content": text }));
        }
    }
    let mut messages = vec![json!({ "role": "system", "content": request["system"] })];
    messages.extend(history.iter().cloned());
    let tools: Vec<Value> = request["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|tool| {
            json!({
                "type": "function",
                "function": { "name": tool["name"], "description": tool["description"], "parameters": tool["parameters"] },
            })
        })
        .collect();
    let mut post = client()
        .post(format!("{}/chat/completions", stored.base_url))
        .json(&json!({ "model": stored.model, "messages": messages, "tools": tools }));
    if let Some(key) = key {
        post = post.bearer_auth(key);
    }
    // openrouter shows where requests come from
    if stored.provider == "openrouter" {
        post = post.header("X-Title", "Morrow");
    }
    let local = stored.provider == "custom";
    let response = post.send().await.map_err(|error| describe_error(&error, local))?;
    if !response.status().is_success() {
        return Err(http_error(response).await);
    }
    let body: Value = response.json().await.map_err(|error| describe_error(&error, local))?;
    let choice = &body["choices"][0];
    let message = &choice["message"];
    if !message.is_object() {
        return Err("The service sent back an empty reply.".into());
    }
    let stamp = paths::now_ms();
    let calls: Vec<Value> = message["tool_calls"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, call)| {
            let mut call = call.clone();
            if call["id"].as_str().is_none_or(str::is_empty) {
                call["id"] = json!(format!("call_{stamp:x}_{index}"));
            }
            call["type"] = json!("function");
            call
        })
        .collect();
    let content = message["content"].as_str().unwrap_or_default().to_string();
    let mut entry = json!({ "role": "assistant", "content": content });
    if !calls.is_empty() {
        entry["tool_calls"] = json!(calls);
    }
    history.push(entry);
    let tool_calls: Vec<Value> = calls
        .iter()
        .map(|call| {
            json!({
                "id": call["id"],
                "name": call["function"]["name"].as_str().unwrap_or_default(),
                "input": parse_arguments(call["function"]["arguments"].as_str()),
            })
        })
        .collect();
    let finish = choice["finish_reason"].as_str().unwrap_or_default();
    let refusal = message["refusal"].as_str().filter(|text| !text.is_empty());
    let refused = finish == "content_filter" || refusal.is_some();
    let text = if message["content"].is_string() { content } else { refusal.unwrap_or_default().to_string() };
    let stop = if refused {
        "refusal"
    } else if finish == "length" {
        "length"
    } else if !tool_calls.is_empty() {
        "tools"
    } else {
        "done"
    };
    Ok(json!({
        "ok": true,
        "history": history,
        "text": text,
        "toolCalls": if refused { vec![] } else { tool_calls },
        "stop": stop,
        "model": body["model"].as_str().unwrap_or(&stored.model),
    }))
}
