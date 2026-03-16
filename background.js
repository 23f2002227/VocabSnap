// VocabSnap – background service worker (Manifest V3)
// Responsibilities:
// - Create the right-click context menu
// - Receive messages from content scripts / popup
// - Fetch definitions (free dictionary API) or fallback to mock data
// - Persist saved words in chrome.storage.local

const STORAGE_KEY = "vocabsnapWords";

/**
 * Simple helper to normalize words (trim punctuation/whitespace).
 * Keep it beginner-friendly and conservative to avoid breaking words like "can't".
 */
function normalizeWord(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    // Remove leading/trailing punctuation commonly picked up in selection.
    .replace(/^[\s"'“”‘’(){}\[\]<>.,!?;:]+/, "")
    .replace(/[\s"'“”‘’(){}\[\]<>.,!?;:]+$/, "");
}

function isSingleWord(word) {
  // Accept hyphenated words and apostrophes.
  return /^[A-Za-z][A-Za-z'-]*$/.test(word);
}

async function getAllWords() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const arr = data[STORAGE_KEY];
  return Array.isArray(arr) ? arr : [];
}

async function setAllWords(words) {
  await chrome.storage.local.set({ [STORAGE_KEY]: words });
}

/**
 * Try to fetch a definition using a free public endpoint.
 * API used: dictionaryapi.dev (no key required)
 *
 * Note: Public APIs can rate-limit or change. We also provide a mock fallback.
 */
async function fetchDefinitionFromApi(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
    word
  )}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dictionary API error: ${res.status}`);

  const data = await res.json();
  // Minimal parsing: take the first definition found.
  const first = Array.isArray(data) ? data[0] : null;
  const meanings = first?.meanings || [];
  const firstMeaning = meanings[0];
  const defs = firstMeaning?.definitions || [];
  const firstDef = defs[0];

  return {
    definition: firstDef?.definition || "Definition not found.",
    example: firstDef?.example || ""
  };
}

function mockDefinition(word, contextText) {
  const ctx = (contextText || "").trim();
  return {
    definition: `Mock definition for "${word}". (Replace with an API call if you prefer.)`,
    example: ctx ? ctx : `Example: I encountered "${word}" while reading.`
  };
}

/**
 * Save a word entry to storage.
 * Dedupe strategy (simple): if the word already exists, we keep the newest version
 * at the top and update its metadata.
 */
async function saveWord({ word, pageUrl, contextText }) {
  const clean = normalizeWord(word);
  if (!clean || !isSingleWord(clean)) {
    return { ok: false, error: "Please select a single word (letters only)." };
  }

  let definition = "";
  let example = "";

  try {
    const api = await fetchDefinitionFromApi(clean.toLowerCase());
    definition = api.definition;
    example = api.example;
  } catch (e) {
    const mocked = mockDefinition(clean, contextText);
    definition = mocked.definition;
    example = mocked.example;
  }

  // If we didn't get an example from the API, try to use the surrounding context.
  if (!example) {
    const ctx = (contextText || "").trim();
    example = ctx || `Example: I encountered "${clean}" while reading.`;
  }

  const now = new Date();
  const entry = {
    id: `${clean.toLowerCase()}-${now.getTime()}`, // simple unique id
    word: clean,
    definition,
    example,
    pageUrl: pageUrl || "",
    dateSaved: now.toISOString()
  };

  const all = await getAllWords();
  const filtered = all.filter(
    (w) => (w.word || "").toLowerCase() !== clean.toLowerCase()
  );
  filtered.unshift(entry);
  await setAllWords(filtered);

  return { ok: true, entry };
}

async function deleteWordById(id) {
  const all = await getAllWords();
  const next = all.filter((w) => w.id !== id);
  await setAllWords(next);
  return { ok: true };
}

// Create context menu on install/update.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "vocabsnap_save_selection",
    title: "Save to VocabSnap",
    contexts: ["selection"]
  });
});

// Handle context menu clicks.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "vocabsnap_save_selection") return;
  const selectedText = info.selectionText || "";
  const pageUrl = tab?.url || "";

  // We don't have rich "context sentence" from the context menu.
  // The content script provides it when you use the in-page popup.
  await saveWord({ word: selectedText, pageUrl, contextText: "" });
});

// Handle messages from content script / popup.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "saveWord") {
        const pageUrl = msg.pageUrl || sender?.tab?.url || "";
        const result = await saveWord({
          word: msg.word,
          pageUrl,
          contextText: msg.contextText || ""
        });
        sendResponse(result);
        return;
      }

      if (msg?.type === "getWords") {
        const all = await getAllWords();
        sendResponse({ ok: true, words: all });
        return;
      }

      if (msg?.type === "deleteWord") {
        const result = await deleteWordById(msg.id);
        sendResponse(result);
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type." });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  // IMPORTANT: Keep the message channel open for async sendResponse.
  return true;
});

