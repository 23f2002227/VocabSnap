// VocabSnap – content script
// Responsibilities:
// - Detect single-word selection on any page with selectable text (web pages, many PDFs, web readers)
// - Show a tiny floating popup near the selection:
//   - Save Word (saves to chrome.storage via background)
//   - Hear Pronunciation (uses speechSynthesis)

let bubbleEl = null;
let lastSelectionWord = "";
let lastContextText = "";

function normalizeWord(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/^[\s"'“”‘’(){}\[\]<>.,!?;:]+/, "")
    .replace(/[\s"'“”‘’(){}\[\]<>.,!?;:]+$/, "");
}

function isSingleWord(word) {
  return /^[A-Za-z][A-Za-z'-]*$/.test(word);
}

function getSelectionRect(sel) {
  try {
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return rect;
  } catch {
    return null;
  }
}

/**
 * Best-effort "context sentence" extraction.
 * Strategy:
 * - If selection is within a text node, grab the nearest block element's text.
 * - Then try to pick a sentence containing the selected word.
 */
function getContextSentence(selectedWord) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const el =
    node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null;
  if (!el) return "";

  const block =
    el.closest("p, li, blockquote, dd, dt, div, span") || el.closest("body");
  const text = (block?.innerText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const w = selectedWord.toLowerCase();
  const parts = text.split(/(?<=[.!?])\s+/);
  const match = parts.find((s) => s.toLowerCase().includes(w));
  return (match || text).slice(0, 240); // keep it short for storage/UI
}

function removeBubble() {
  if (bubbleEl) bubbleEl.remove();
  bubbleEl = null;
}

function ensureBubble() {
  if (bubbleEl) return bubbleEl;

  bubbleEl = document.createElement("div");
  bubbleEl.id = "vocabsnap-bubble";
  bubbleEl.innerHTML = `
    <button id="vocabsnap-save" type="button">Save Word</button>
    <button id="vocabsnap-hear" type="button" aria-label="Hear pronunciation">Hear</button>
    <div id="vocabsnap-status" role="status" aria-live="polite"></div>
  `;

  // Minimal inline styles to avoid requiring an extra CSS file.
  // (You can easily move this to a separate stylesheet later.)
  Object.assign(bubbleEl.style, {
    position: "fixed",
    zIndex: 2147483647,
    background: "rgba(20, 20, 20, 0.95)",
    color: "#fff",
    padding: "8px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    display: "flex",
    gap: "6px",
    alignItems: "center",
    fontFamily:
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    fontSize: "12px",
    maxWidth: "320px"
  });

  const buttons = bubbleEl.querySelectorAll("button");
  buttons.forEach((btn) => {
    Object.assign(btn.style, {
      appearance: "none",
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.08)",
      color: "#fff",
      padding: "6px 10px",
      borderRadius: "8px",
      cursor: "pointer",
      lineHeight: "1"
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255,255,255,0.14)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(255,255,255,0.08)";
    });
  });

  const statusEl = bubbleEl.querySelector("#vocabsnap-status");
  Object.assign(statusEl.style, {
    marginLeft: "6px",
    opacity: "0.9",
    maxWidth: "160px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  });

  bubbleEl
    .querySelector("#vocabsnap-save")
    .addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!lastSelectionWord) return;
      statusEl.textContent = "Saving…";

      chrome.runtime.sendMessage(
        {
          type: "saveWord",
          word: lastSelectionWord,
          contextText: lastContextText,
          pageUrl: location.href
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            statusEl.textContent = "Could not save.";
            return;
          }
          if (!resp?.ok) {
            statusEl.textContent = resp?.error || "Could not save.";
            return;
          }
          statusEl.textContent = "Saved!";
          // Auto-hide to avoid blocking reading.
          setTimeout(removeBubble, 700);
        }
      );
    });

  bubbleEl
    .querySelector("#vocabsnap-hear")
    .addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!lastSelectionWord) return;
      try {
        const u = new SpeechSynthesisUtterance(lastSelectionWord);
        u.lang = "en-US";
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        statusEl.textContent = "Speaking…";
        setTimeout(() => {
          if (statusEl.textContent === "Speaking…") statusEl.textContent = "";
        }, 800);
      } catch {
        statusEl.textContent = "Speech not available.";
      }
    });

  document.documentElement.appendChild(bubbleEl);
  return bubbleEl;
}

function positionBubbleNearRect(rect) {
  if (!rect) return;
  const bubble = ensureBubble();

  // Place slightly above the selection; clamp inside viewport.
  const margin = 10;
  const desiredLeft = rect.left + rect.width / 2;
  const desiredTop = rect.top - margin;

  // Need dimensions AFTER it's in the DOM.
  const b = bubble.getBoundingClientRect();

  let left = desiredLeft - b.width / 2;
  let top = desiredTop - b.height;

  // If above is off-screen, place below.
  if (top < margin) top = rect.bottom + margin;

  left = Math.min(Math.max(margin, left), window.innerWidth - b.width - margin);
  top = Math.min(Math.max(margin, top), window.innerHeight - b.height - margin);

  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}

function handleSelection() {
  const sel = window.getSelection();
  if (!sel) return removeBubble();

  const raw = sel.toString();
  const word = normalizeWord(raw);
  if (!word || !isSingleWord(word)) return removeBubble();

  const rect = getSelectionRect(sel);
  if (!rect) return removeBubble();

  lastSelectionWord = word;
  lastContextText = getContextSentence(word);

  positionBubbleNearRect(rect);
}

// Show bubble when selection changes via mouse/touch.
document.addEventListener("mouseup", () => {
  // Delay a tick so selection is updated.
  setTimeout(handleSelection, 0);
});
document.addEventListener("keyup", (e) => {
  // Support keyboard-based selection (Shift+Arrow).
  if (e.key === "Shift" || e.key.startsWith("Arrow")) {
    setTimeout(handleSelection, 0);
  }
});

// Hide bubble when clicking elsewhere or scrolling.
document.addEventListener(
  "mousedown",
  (e) => {
    if (!bubbleEl) return;
    if (e.target && bubbleEl.contains(e.target)) return;
    removeBubble();
  },
  true
);
window.addEventListener("scroll", () => {
  // Reposition bubble if the user scrolls while it is open.
  if (!bubbleEl) return;
  const sel = window.getSelection();
  const rect = getSelectionRect(sel);
  positionBubbleNearRect(rect);
});

