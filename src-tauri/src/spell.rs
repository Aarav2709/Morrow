// spelling checked by morrow itself, in several languages at once. the web view on windows checks words in
// one language only, the one it was started in, and has no way to be given more. each language's dictionary
// is fetched once, when it is first needed, and kept beside morrow's other files. a word is only wrong when
// no language picked knows it
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use spellbook::Dictionary;

type Res<T> = Result<T, String>;

const CDN: &str = "https://cdn.jsdelivr.net/npm";
const MAX_DICTIONARY_BYTES: usize = 40 * 1024 * 1024;
const PERSONAL_FILE: &str = "spell-words.txt";

// the hunspell dictionary package for a language, by its code such as en-GB or pt-BR, pinned to a version
fn package(code: &str) -> Option<(&'static str, &'static str)> {
    let lower = code.to_ascii_lowercase().replace('_', "-");
    let (language, region) = lower.split_once('-').unwrap_or((lower.as_str(), ""));
    Some(match language {
        // english as most of the world writes it, colour and organise, or as america does
        "en" if matches!(region, "gb" | "in" | "au" | "nz" | "ie" | "za" | "sg") => {
            ("dictionary-en-gb", "3.0.0")
        }
        "en" => ("dictionary-en", "4.0.0"),
        "es" if region.is_empty() || region == "es" => ("dictionary-es", "4.0.0"),
        "es" => ("dictionary-es-mx", "2.0.0"),
        // the portuguese package is brazil's, portugal's has one of its own
        "pt" if region.is_empty() || region == "br" => ("dictionary-pt", "4.0.0"),
        "pt" => ("dictionary-pt-pt", "2.0.0"),
        "fr" => ("dictionary-fr", "3.0.0"),
        "de" => ("dictionary-de", "3.0.0"),
        "it" => ("dictionary-it", "2.0.0"),
        "nl" => ("dictionary-nl", "2.0.0"),
        "ca" => ("dictionary-ca", "3.0.0"),
        "sv" => ("dictionary-sv", "4.0.0"),
        "da" => ("dictionary-da", "6.0.0"),
        "nb" | "no" => ("dictionary-nb", "3.0.0"),
        "pl" => ("dictionary-pl", "2.0.0"),
        "cs" => ("dictionary-cs", "4.0.0"),
        "hu" => ("dictionary-hu", "3.0.0"),
        "ro" => ("dictionary-ro", "3.0.0"),
        "el" => ("dictionary-el", "4.0.0"),
        "tr" => ("dictionary-tr", "2.0.0"),
        "ru" => ("dictionary-ru", "3.0.0"),
        "uk" => ("dictionary-uk", "4.0.0"),
        "vi" => ("dictionary-vi", "3.0.0"),
        _ => return None,
    })
}

#[derive(Default)]
struct Loaded {
    // by package, so en-US and en-CA share one dictionary
    dictionaries: HashMap<&'static str, Arc<Dictionary>>,
    // packages being fetched or read, so a second ask waits rather than fetching again
    failed: HashMap<&'static str, String>,
}

fn loaded() -> &'static Mutex<Loaded> {
    static LOADED: OnceLock<Mutex<Loaded>> = OnceLock::new();
    LOADED.get_or_init(|| Mutex::new(Loaded::default()))
}

// words added with Add to dictionary, one a line, the same for every language
fn personal() -> &'static Mutex<Option<std::collections::HashSet<String>>> {
    static WORDS: OnceLock<Mutex<Option<std::collections::HashSet<String>>>> = OnceLock::new();
    WORDS.get_or_init(|| Mutex::new(None))
}

fn personal_words() -> std::collections::HashSet<String> {
    let mut guard = personal()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    guard
        .get_or_insert_with(|| {
            std::fs::read_to_string(crate::paths::data_dir().join(PERSONAL_FILE))
                .unwrap_or_default()
                .lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect()
        })
        .clone()
}

pub fn add_word(word: &str) -> Res<()> {
    let word = word.trim();
    if word.is_empty() || word.len() > 80 || word.contains(['\n', '\r']) {
        return Err("Not a word.".into());
    }
    let mut words = personal_words();
    if !words.insert(word.to_string()) {
        return Ok(());
    }
    let mut sorted: Vec<&String> = words.iter().collect();
    sorted.sort();
    let text = sorted
        .iter()
        .map(|word| word.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(
        crate::paths::data_dir().join(PERSONAL_FILE),
        format!("{text}\n"),
    )
    .map_err(|error| error.to_string())?;
    *personal()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some(words);
    Ok(())
}

fn folder() -> PathBuf {
    crate::paths::data_dir().join("Dictionaries")
}

async fn fetch(url: &str) -> Res<String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Morrow/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("The dictionary answered {}.", response.status()));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_DICTIONARY_BYTES {
        return Err("Too large.".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Not a dictionary.".to_string())
}

// the dictionary for a package, read from disk, or fetched the first time and kept
async fn dictionary(name: &'static str, version: &'static str) -> Res<Arc<Dictionary>> {
    if let Some(found) = loaded()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .dictionaries
        .get(name)
    {
        return Ok(found.clone());
    }
    let dir = folder().join(format!("{name}@{version}"));
    let aff_path = dir.join("index.aff");
    let dic_path = dir.join("index.dic");
    let (aff, dic) = match (
        std::fs::read_to_string(&aff_path),
        std::fs::read_to_string(&dic_path),
    ) {
        (Ok(aff), Ok(dic)) => (aff, dic),
        _ => {
            let aff = fetch(&format!("{CDN}/{name}@{version}/index.aff")).await?;
            let dic = fetch(&format!("{CDN}/{name}@{version}/index.dic")).await?;
            std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
            // the .dic last, it is what says the download finished
            std::fs::write(&aff_path, &aff).map_err(|error| error.to_string())?;
            std::fs::write(&dic_path, &dic).map_err(|error| error.to_string())?;
            (aff, dic)
        }
    };
    let parsed = tauri::async_runtime::spawn_blocking(move || Dictionary::new(&aff, &dic))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let parsed = Arc::new(parsed);
    loaded()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .dictionaries
        .insert(name, parsed.clone());
    Ok(parsed)
}

// the dictionaries of the languages picked, or the system's own, loading any not loaded yet. a language that
// can't be had is left out and said so, the others still check
async fn dictionaries() -> (Vec<Arc<Dictionary>>, Vec<String>) {
    let mut wanted: Vec<(&'static str, &'static str)> = Vec::new();
    let mut missing = Vec::new();
    for code in crate::native::spell_languages() {
        match package(&code) {
            Some(found) if !wanted.contains(&found) => wanted.push(found),
            Some(_) => {}
            None => missing.push(code),
        }
    }
    if wanted.is_empty() {
        wanted.push(("dictionary-en", "4.0.0"));
    }
    let mut out = Vec::new();
    for (name, version) in wanted {
        if loaded()
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .failed
            .contains_key(name)
        {
            missing.push(name.trim_start_matches("dictionary-").to_string());
            continue;
        }
        match dictionary(name, version).await {
            Ok(dictionary) => out.push(dictionary),
            Err(error) => {
                loaded()
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .failed
                    .insert(name, error);
                missing.push(name.trim_start_matches("dictionary-").to_string());
            }
        }
    }
    (out, missing)
}

// a word any language knows, as written or as it would start a sentence
fn known(
    dictionaries: &[Arc<Dictionary>],
    personal: &std::collections::HashSet<String>,
    word: &str,
) -> bool {
    if personal.contains(word) || personal.contains(&word.to_lowercase()) {
        return true;
    }
    dictionaries.iter().any(|dictionary| dictionary.check(word))
}

#[derive(serde::Serialize)]
pub struct Checked {
    // the words no language picked knows
    wrong: Vec<String>,
    // languages that could not be had, such as with no connection the first time
    missing: Vec<String>,
}

pub async fn check(words: Vec<String>) -> Checked {
    let (dictionaries, missing) = dictionaries().await;
    if dictionaries.is_empty() {
        return Checked {
            wrong: Vec::new(),
            missing,
        };
    }
    let personal = personal_words();
    let wrong = tauri::async_runtime::spawn_blocking(move || {
        words
            .into_iter()
            .take(5000)
            .filter(|word| word.chars().count() <= 60 && !known(&dictionaries, &personal, word))
            .collect()
    })
    .await
    .unwrap_or_default();
    Checked { wrong, missing }
}

// what a word might have meant, the first few from each language
pub async fn suggest(word: String) -> Vec<String> {
    let (dictionaries, _) = dictionaries().await;
    tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<String> = Vec::new();
        for dictionary in &dictionaries {
            let mut found = Vec::new();
            dictionary.suggest(&word, &mut found);
            for item in found.into_iter().take(4) {
                if !out.contains(&item) {
                    out.push(item);
                }
            }
        }
        // the word with only its accents or capitals put right comes first, from whichever language
        let plain = without_accents(&word);
        out.sort_by_key(|item| without_accents(item) != plain);
        out.truncate(8);
        out
    })
    .await
    .unwrap_or_default()
}

// a word in small letters with the marks over its letters taken off, cancion for canción
fn without_accents(word: &str) -> String {
    word.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

// languages picked again start from a clean slate, one that failed to download is tried again
pub fn forget_failures() {
    loaded()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .failed
        .clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_a_dictionary_for_each_kind_of_language() {
        assert_eq!(package("en-IN").unwrap().0, "dictionary-en-gb");
        assert_eq!(package("en-US").unwrap().0, "dictionary-en");
        assert_eq!(package("es-ES").unwrap().0, "dictionary-es");
        assert_eq!(package("es-MX").unwrap().0, "dictionary-es-mx");
        assert_eq!(package("pt-BR").unwrap().0, "dictionary-pt");
        assert_eq!(package("pt_PT").unwrap().0, "dictionary-pt-pt");
        assert!(package("xx-YY").is_none());
    }

    #[test]
    fn a_word_is_wrong_only_when_no_language_knows_it() {
        let english = Dictionary::new("SET UTF-8\n", "2\nheart\nis\n").unwrap();
        let spanish = Dictionary::new("SET UTF-8\n", "2\ncorazón\nes\n").unwrap();
        let both = vec![Arc::new(english), Arc::new(spanish)];
        let personal = std::collections::HashSet::from(["Morrow".to_string()]);
        assert!(known(&both, &personal, "heart"));
        assert!(known(&both, &personal, "corazón"));
        assert!(known(&both, &personal, "Morrow"));
        assert!(!known(&both, &personal, "hart"));
    }
}
