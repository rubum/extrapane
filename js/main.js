/**
 * main.js
 * Application entry point. Orchestrates initialization, 
 * event delegation, and the core message loop.
 */

import { 
  state, 
  loadSettings, 
  saveSettings, 
  saveTabsToStorage 
} from './state.js';
import { buildPrompt } from './prompts.js';
import { getAIProvider } from './api.js';
import { elements, applyTheme, smartScroll, showToast, scrollToBottom, escapeHtml } from './ui.js';
import { 
  appendMessage, 
  appendStreamingMessage, 
  showWelcomeMessage, 
  renderCharts,
  renderDiagrams,
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
  
  renderTabs();
  const activeTab = getActiveTab();
  if (activeTab && activeTab.history.length > 0) {
    reconstructChatFromHistory();
    renderContextChips();
  } else {
    showWelcomeMessage();
  }
});

// --- Tab Helpers ---

function getActiveTab() {
  return state.tabs.find(t => t.id === state.activeTabId) || state.tabs[0];
}

function createTab() {
  const newTab = {
    id: Date.now().toString(),
    title: 'New Chat',
    history: [],
    contexts: []
  };
  state.tabs.push(newTab);
  state.activeTabId = newTab.id;
  saveTabsToStorage();
  renderTabs();
  reconstructChatFromHistory();
  renderContextChips();
  showWelcomeMessage();
}

function removeTab(id, e) {
  if (e) e.stopPropagation();
  if (state.tabs.length === 1) {
    // Just clear the last tab instead of removing it
    const tab = state.tabs[0];
    tab.history = [];
    tab.contexts = [];
    tab.title = 'New Chat';
    saveTabsToStorage();
    renderTabs();
    reconstructChatFromHistory();
    renderContextChips();
    showWelcomeMessage();
    return;
  }

  const index = state.tabs.findIndex(t => t.id === id);
  state.tabs.splice(index, 1);
  
  if (state.activeTabId === id) {
    state.activeTabId = state.tabs[Math.max(0, index - 1)].id;
  }
  
  saveTabsToStorage();
  renderTabs();
  reconstructChatFromHistory();
  renderContextChips();
}

function switchTab(id) {
  if (state.activeTabId === id) return;
  state.activeTabId = id;
  saveTabsToStorage();
  renderTabs();
  reconstructChatFromHistory();
  renderContextChips();
}

function renderTabs() {
  elements.tabsList.innerHTML = '';
  state.tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab-item ${tab.id === state.activeTabId ? 'active' : ''}`;
    tabEl.innerHTML = `
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <span class="close-tab" data-id="${tab.id}">&times;</span>
    `;
    tabEl.addEventListener('click', () => switchTab(tab.id));
    tabEl.querySelector('.close-tab').addEventListener('click', (e) => removeTab(tab.id, e));
    elements.tabsList.appendChild(tabEl);
  });
}

// --- Core Logic ---

/** 
 * Primary loop for sending a message. 
 * Orchestrates prompt building, UI updates, and AI streaming.
 */
async function sendMessage(text) {
  if (!text.trim()) return;

  const currentTab = getActiveTab();
  const promptParts = buildPrompt(text, currentTab.contexts);
  const userIndex = currentTab.history.length;
  appendMessage('user', marked.parse(text), userIndex);
  scrollToBottom();
  
  currentTab.history.push({ role: "user", parts: promptParts });
  
  // Update tab title if it's the first message
  if (currentTab.history.length === 1) {
    currentTab.title = text.length > 20 ? text.substring(0, 20) + '...' : text;
    renderTabs();
  }
  
  saveTabsToStorage();
  
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';

  let streaming;
  try {
    const provider = getAIProvider(state.userModel);
    const aiIndex = currentTab.history.length;
    streaming = appendStreamingMessage(aiIndex);
    let accumulatedText = '';

    const stream = provider.streamGenerateContent(
      state.userApiKey, 
      state.userModel, 
      currentTab.history.slice(0, -1), 
      promptParts
    );

    for await (const chunk of stream) {
      accumulatedText += chunk;
      streaming.update(accumulatedText);
    }

    streaming.finalize(accumulatedText);
    currentTab.history.push({ role: "model", parts: [{ text: accumulatedText }] });
    saveTabsToStorage();

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
  const currentTab = getActiveTab();
  if (currentTab.history.length === 0) {
    showWelcomeMessage();
    return;
  }
  
  currentTab.history.forEach((msg, index) => {
    const isUser = msg.role === 'user';
    const content = isUser ? extractUserQuestion(msg.parts[0].text) : msg.parts[0].text;
    appendMessage(isUser ? 'user' : 'AI', marked.parse(content), index);
  });
  scrollToBottom();
}

/** 
 * What: Helper to pull the clean user question out of a context-rich prompt.
 * Why: The stored history contains the massive AI prompt (with system instructions and contexts).
 *      When displaying the user's message in the UI or editing it, we only want the actual text they typed.
 */
function extractUserQuestion(promptText) {
  if (typeof promptText === 'string' && promptText.includes('User Question:')) {
    return promptText.split('User Question:')[1].trim();
  }
  return promptText;
}

// --- Event Listeners ---

elements.sendBtn.addEventListener('click', () => sendMessage(elements.chatInput.value));
elements.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(elements.chatInput.value);
  }
});

elements.newTabBtn.addEventListener('click', createTab);
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

async function addContext(data) {
  const currentTab = getActiveTab();
  
  // If the extracted element contains images, we need to convert them all to base64
  if (data.images && data.images.length > 0) {
    data.base64Images = [];
    for (const imgData of data.images) {
      try {
        /**
         * What: Fetch the image, draw it to a canvas, and encode it as a base64 JPEG.
         * Why: Chrome extension storage limits and Gemini API requirements mean we need 
         *      a reliable, size-controlled base64 string.
         */
        const maxDim = 1024;
        const response = await fetch(imgData.src);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        
        let width = bitmap.width;
        let height = bitmap.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, width, height);
        
        const base64DataUrl = canvas.toDataURL('image/jpeg', 0.8);
        data.base64Images.push({
          base64: base64DataUrl.split(',')[1],
          mimeType: 'image/jpeg',
          alt: imgData.alt
        });
      } catch (e) {
        console.error("Failed to process image:", e);
      }
    }
    
    // Cleanup the original verbose URLs array if we want to save local storage space, 
    // but keep it for reference just in case.
  }

  currentTab.contexts.push(data);
  saveTabsToStorage();
  renderContextChips();
}

/** 
 * What: Renders removable 'chips' for selected webpage elements.
 * Why: Gives the user visual confirmation of what they've extracted and allows them to manage 
 *      the context before sending to the AI.
 */
function renderContextChips() {
  elements.contextContainer.innerHTML = '';
  const currentTab = getActiveTab();
  currentTab.contexts.forEach((ctx, index) => {
    const chip = document.createElement('div');
    chip.className = 'context-chip';
    const text = ctx.text || "";
    const tag = ctx.tag || "ELEMENT";
    const subtext = ctx.id ? `#${ctx.id}` : (ctx.className ? `.${ctx.className.split(' ')[0]}` : tag);
    
    /**
     * What: Generate a preview body that handles both standard text and image previews.
     * Why: We want users to see exactly what visual context they have captured, so if base64 
     *      image data is present, we display an img tag using that data URL.
     */
    let textHtml = text ? `<div class="preview-text-part">${escapeHtml(text)}</div>` : '';
    let imagesHtml = '';
    
    if (ctx.base64Images && ctx.base64Images.length > 0) {
      imagesHtml = '<div class="preview-images-container" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">';
      ctx.base64Images.forEach(img => {
        imagesHtml += `<img src="data:${img.mimeType};base64,${img.base64}" style="max-height: 100px; max-width: 100%; border-radius: 4px; object-fit: contain;" alt="Context Image" />`;
      });
      imagesHtml += '</div>';
    }
    
    let previewBodyHtml = `<div class="preview-body">${textHtml}${imagesHtml}</div>`;

    chip.innerHTML = `
      <span class="chip-text"><b>${tag}</b> ${subtext}</span>
      <button class="remove-chip" data-index="${index}">&times;</button>
      <div class="context-preview">
        <div class="preview-header">
          <span class="preview-tag">${tag}</span>
          ${ctx.id ? `<span class="preview-id">#${ctx.id}</span>` : ''}
          ${ctx.className ? `<span class="preview-class">.${ctx.className.replace(/\s+/g, '.')}</span>` : ''}
        </div>
        ${previewBodyHtml}
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
    const currentTab = getActiveTab();
    currentTab.contexts.splice(index, 1);
    saveTabsToStorage();
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
    const currentTab = getActiveTab();
    const msg = currentTab.history[idx];
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
      const currentTab = getActiveTab();
      currentTab.history = currentTab.history.slice(0, idx);
      saveTabsToStorage();
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
      const currentTab = getActiveTab();
      const lastUserMsg = currentTab.history[idx - 1];
      if (lastUserMsg && lastUserMsg.role === 'user') {
        const question = extractUserQuestion(lastUserMsg.parts[0].text);
        currentTab.history = currentTab.history.slice(0, idx - 1);
        saveTabsToStorage();
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

/** Clears the current tab's conversation and contexts. */
elements.clearBtn.addEventListener('click', () => {
  if (confirm("Are you sure you want to clear this conversation?")) {
    const currentTab = getActiveTab();
    currentTab.history = [];
    currentTab.contexts = [];
    currentTab.title = 'New Chat';
    elements.contextContainer.innerHTML = '';
    elements.chatInput.value = '';
    saveTabsToStorage();
    renderTabs();
    elements.chatHistory.innerHTML = '';
    showWelcomeMessage();
  }
});

// Auto-resize input textarea based on content
elements.chatInput.addEventListener('input', () => {
  elements.chatInput.style.height = 'auto';
  elements.chatInput.style.height = (elements.chatInput.scrollHeight) + 'px';
});

