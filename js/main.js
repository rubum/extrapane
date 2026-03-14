/**
 * main.js
 * Application entry point. Orchestrates initialization, 
 * event delegation, and the core message loop.
 */

import { state, loadSettings, saveSettings, saveHistoryToStorage } from './state.js';
import { buildPrompt } from './prompts.js';
import { getAIProvider } from './api.js';
import { elements, applyTheme, smartScroll, showToast, scrollToBottom } from './ui.js';
import { 
  appendMessage, 
  appendStreamingMessage, 
  showWelcomeMessage, 
  renderCharts,
  clearWelcomeCard
} from './chat.js';

// --- Initialization ---

/** Loads user settings and conversation history on startup. */
loadSettings((loadedState) => {
  if (loadedState.userApiKey) elements.apiKeyInput.value = loadedState.userApiKey;
  if (loadedState.userModel) elements.modelNameSelect.value = loadedState.userModel;
  if (loadedState.userTheme) {
    elements.themeSelect.value = loadedState.userTheme;
    applyTheme(loadedState.userTheme);
  }
  
  if (loadedState.conversationHistory && loadedState.conversationHistory.length > 0) {
    reconstructChatFromHistory();
  } else {
    showWelcomeMessage();
  }
});

// --- Core Logic ---

/** 
 * Primary loop for sending a message. 
 * Orchestrates prompt building, UI updates, and AI streaming.
 */
async function sendMessage(text) {
  if (!text.trim()) return;

  const fullPrompt = buildPrompt(text, state.selectedContexts);
  const userIndex = state.conversationHistory.length;
  appendMessage('user', marked.parse(text), userIndex);
  scrollToBottom();
  
  state.conversationHistory.push({ role: "user", parts: [{ text: fullPrompt }] });
  saveHistoryToStorage();
  
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';

  let streaming;
  try {
    const provider = getAIProvider(state.userModel);
    const aiIndex = state.conversationHistory.length;
    streaming = appendStreamingMessage(aiIndex);
    let accumulatedText = '';

    const stream = provider.streamGenerateContent(
      state.userApiKey, 
      state.userModel, 
      state.conversationHistory.slice(0, -1), 
      fullPrompt
    );

    for await (const chunk of stream) {
      accumulatedText += chunk;
      streaming.update(accumulatedText);
    }

    streaming.finalize(accumulatedText);
    state.conversationHistory.push({ role: "model", parts: [{ text: accumulatedText }] });
    saveHistoryToStorage();

  } catch (error) {
    if (streaming) {
      streaming.finalize(""); // Clear the "Responding" bubble
    }
    showToast(`Note: ${error.message}`);
    appendMessage('AI', `<div class="error-bubble"><b>Hold on a moment:</b> ${error.message}</div>`);
  }
}

/** Re-renders the entire chat from the stored conversation history. */
function reconstructChatFromHistory() {
  if (!elements.chatHistory) return;
  elements.chatHistory.innerHTML = '';
  state.conversationHistory.forEach((msg, index) => {
    const isUser = msg.role === 'user';
    const content = isUser ? extractUserQuestion(msg.parts[0].text) : msg.parts[0].text;
    appendMessage(isUser ? 'user' : 'AI', marked.parse(content), index);
  });
  scrollToBottom();
}

/** Helper to pull the clean user question out of a context-rich prompt. */
function extractUserQuestion(fullPrompt) {
  if (fullPrompt.includes('User Question:')) {
    return fullPrompt.split('User Question:')[1].trim();
  }
  return fullPrompt;
}

// --- Event Listeners ---

elements.sendBtn.addEventListener('click', () => sendMessage(elements.chatInput.value));
elements.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(elements.chatInput.value);
  }
});

elements.extractBtn.addEventListener('click', toggleExtraction);

/** Toggles element selection mode on/off. */
function toggleExtraction() {
  state.isExtracting = !state.isExtracting;
  elements.extractBtn.classList.toggle('active', state.isExtracting);
  elements.inputWrapper.classList.toggle('extracting', state.isExtracting);
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.runtime.sendMessage({ 
        type: state.isExtracting ? "START_SELECTION" : "STOP_SELECTION",
        tabId: tabs[0].id
      });
    }
  });
}

// Relay messages from content script
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "ELEMENT_SELECTED") {
    addContext(request.data);
  } else if (request.type === "SELECTION_CANCELLED") {
    state.isExtracting = false;
    elements.extractBtn.classList.remove('active');
    elements.inputWrapper.classList.remove('extracting');
  }
});

function addContext(data) {
  state.selectedContexts.push(data);
  renderContextChips();
}

/** Renders removable 'chips' for selected webpage elements. */
function renderContextChips() {
  elements.contextContainer.innerHTML = '';
  state.selectedContexts.forEach((ctx, index) => {
    const chip = document.createElement('div');
    chip.className = 'context-chip';
    const text = ctx.text || "";
    const tag = ctx.tag || "ELEMENT";
    const subtext = ctx.id ? `#${ctx.id}` : (ctx.className ? `.${ctx.className.split(' ')[0]}` : tag);
    
    chip.innerHTML = `
      <span class="chip-text"><b>${tag}</b> ${subtext}</span>
      <button class="remove-chip" data-index="${index}">&times;</button>
      <div class="context-preview">
        <div class="preview-header">
          <span class="preview-tag">${tag}</span>
          ${ctx.id ? `<span class="preview-id">#${ctx.id}</span>` : ''}
          ${ctx.className ? `<span class="preview-class">.${ctx.className.replace(/\s+/g, '.')}</span>` : ''}
        </div>
        <div class="preview-body">${escapeHtml(text)}</div>
      </div>
    `;
    elements.contextContainer.appendChild(chip);
  });
}

// Handle chip removal via delegation
elements.contextContainer.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.remove-chip');
  if (removeBtn) {
    const index = parseInt(removeBtn.getAttribute('data-index'));
    state.selectedContexts.splice(index, 1);
    renderContextChips();
  }
});

// Handle actions (copy, edit, retry) via delegation on chat history
elements.chatHistory.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  const msgContainer = btn.closest('.message');
  const index = msgContainer?.getAttribute('data-index');

  if (btn.classList.contains('copy-btn')) {
    const text = msgContainer.querySelector('.message-content').innerText;
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
  }

  if (btn.classList.contains('copy-code-btn')) {
    const code = btn.getAttribute('data-code');
    navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
  }

  if (btn.classList.contains('edit-btn-trigger')) {
    const idx = parseInt(index);
    const msg = state.conversationHistory[idx];
    if (msg && msg.role === 'user') {
      const editArea = msgContainer.querySelector('.edit-area');
      const content = msgContainer.querySelector('.message-content');
      const question = extractUserQuestion(msg.parts[0].text);
      
      content.style.display = 'none';
      msgContainer.querySelector('.message-actions').style.display = 'none';
      editArea.innerHTML = `
        <textarea class="edit-textarea">${question}</textarea>
        <div class="edit-buttons">
          <button class="save-edit-btn">Save & Retry</button>
          <button class="cancel-edit-btn">Cancel</button>
        </div>
      `;
    }
  }

  if (btn.classList.contains('save-edit-btn')) {
    const idx = parseInt(index);
    const newText = msgContainer.querySelector('.edit-textarea').value;
    if (newText.trim()) {
      state.conversationHistory = state.conversationHistory.slice(0, idx);
      saveHistoryToStorage();
      reconstructChatFromHistory();
      sendMessage(newText);
    }
  }

  if (btn.classList.contains('cancel-edit-btn')) {
    reconstructChatFromHistory();
  }

  if (btn.classList.contains('retry-btn')) {
    const idx = parseInt(index);
    if (!isNaN(idx) && idx > 0) {
      const lastUserMsg = state.conversationHistory[idx - 1];
      if (lastUserMsg && lastUserMsg.role === 'user') {
        const question = extractUserQuestion(lastUserMsg.parts[0].text);
        state.conversationHistory = state.conversationHistory.slice(0, idx - 1);
        saveHistoryToStorage();
        reconstructChatFromHistory();
        sendMessage(question);
      }
    }
  }
});

// Settings Overlay Management
elements.settingsBtn.addEventListener('click', () => elements.settingsOverlay.classList.remove('hidden'));
elements.closeSettingsBtn.addEventListener('click', () => elements.settingsOverlay.classList.add('hidden'));
elements.saveSettingsBtn.addEventListener('click', () => {
  saveSettings(
    elements.apiKeyInput.value,
    elements.modelNameSelect.value,
    elements.themeSelect.value
  );
  applyTheme(state.userTheme);
  elements.settingsOverlay.classList.add('hidden');
  showToast('Settings saved!');
});

/** Clears all stored chat data and resets UI. */
elements.clearBtn.addEventListener('click', () => {
  if (confirm("Are you sure you want to clear this conversation?")) {
    state.conversationHistory = [];
    state.selectedContexts = [];
    elements.contextContainer.innerHTML = '';
    elements.chatInput.value = '';
    saveHistoryToStorage();
    elements.chatHistory.innerHTML = '';
    showWelcomeMessage();
  }
});

// Auto-resize input textarea based on content
elements.chatInput.addEventListener('input', () => {
  elements.chatInput.style.height = 'auto';
  elements.chatInput.style.height = (elements.chatInput.scrollHeight) + 'px';
});

function escapeHtml(unsafe) {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
