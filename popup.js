// VocabSnap – popup script
// Responsibilities:
// - Load saved words from chrome.storage via background.js
// - Render list
// - Search/filter
// - Delete items

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const searchEl = document.getElementById("search");
const refreshEl = document.getElementById("refresh");
const countEl = document.getElementById("count");

let allWords = [];

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso || "";
  }
}

function matchesQuery(entry, q) {
  if (!q) return true;
  const hay = `${entry.word} ${entry.definition} ${entry.example}`
    .toLowerCase()
    .trim();
  return hay.includes(q);
}

function render() {
  const q = (searchEl.value || "").toLowerCase().trim();
  const filtered = allWords.filter((w) => matchesQuery(w, q));

  listEl.innerHTML = "";

  if (filtered.length === 0) {
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
  }

  filtered.forEach((w) => {
    const li = document.createElement("li");
    li.className = "item";

    const safeWord = escapeHtml(w.word || "");
    const safeDef = escapeHtml(w.definition || "");
    const safeEx = escapeHtml(w.example || "");
    const safeUrl = escapeHtml(w.pageUrl || "");
    const saved = formatDate(w.dateSaved);

    li.innerHTML = `
      <div class="row">
        <div>
          <div class="word">${safeWord}</div>
          <div class="meta">
            Saved: ${escapeHtml(saved)}
            ${safeUrl ? ` • <a href="${safeUrl}" target="_blank" rel="noreferrer">Source</a>` : ""}
          </div>
        </div>
        <div class="actions">
          <button class="btn-danger" data-action="delete" data-id="${escapeHtml(
            w.id
          )}" type="button">
            Delete
          </button>
        </div>
      </div>
      <div class="def">${safeDef}</div>
      <div class="example">${safeEx}</div>
    `;

    listEl.appendChild(li);
  });

  countEl.textContent = `${filtered.length} shown • ${allWords.length} total`;
}

async function loadWords() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "getWords" }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, words: [] });
        return;
      }
      resolve(resp);
    });
  });
}

async function deleteWord(id) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "deleteWord", id }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false });
        return;
      }
      resolve(resp);
    });
  });
}

async function refresh() {
  const resp = await loadWords();
  allWords = resp?.ok && Array.isArray(resp.words) ? resp.words : [];
  render();
}

// Event listeners
searchEl.addEventListener("input", render);
refreshEl.addEventListener("click", refresh);

listEl.addEventListener("click", async (e) => {
  const btn = e.target?.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");

  if (action === "delete" && id) {
    btn.disabled = true;
    await deleteWord(id);
    await refresh();
  }
});

// Initial load
refresh();

