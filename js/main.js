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
elements.uploadBtn.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', handleFileSelect);

async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  for (const file of files) {
    try {
      await processFile(file);
    } catch (err) {
      console.error(`Failed to process file ${file.name}:`, err);
      showToast(`Error processing ${file.name}`);
    }
  }
  // Clear the input so the same file can be selected again
  elements.fileInput.value = '';
}

async function processFile(file) {
  const data = {
    tag: 'FILE',
    name: file.name,
    type: file.type,
    size: file.size
  };

  if (file.type.startsWith('image/')) {
    const base64Data = await fileToBase64(file);
    const processed = await resizeImage(base64Data);
    data.base64Images = [{
      base64: processed.base64,
      mimeType: processed.mimeType,
      alt: file.name
    }];
  } else if (file.type === 'application/pdf') {
    const base64Data = await fileToBase64(file);
    data.base64File = {
      base64: base64Data.split(',')[1],
      mimeType: file.type
    };
  } else if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.js') || file.name.endsWith('.css') || file.name.endsWith('.html')) {
    const text = await file.text();
    data.text = text;
  } else {
    // Unsupported file type for AI but we'll try to read as text if it's small
    if (file.size < 1024 * 1024) { // 1MB
      data.text = await file.text();
    } else {
      throw new Error("Unsupported file type or file too large.");
    }
  }

  addContext(data);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function resizeImage(dataUrl) {
  return new Promise((resolve) => {
    const maxDim = 1024;
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
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
      ctx.drawImage(img, 0, 0, width, height);
      const resizedBase64 = canvas.toDataURL('image/jpeg', 0.8);
      resolve({
        base64: resizedBase64.split(',')[1],
        mimeType: 'image/jpeg'
      });
    };
    img.src = dataUrl;
  });
}

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
    if (ctx.tag === 'FILE') chip.setAttribute('data-type', 'FILE');
    const text = ctx.text || "";
    const tag = ctx.tag || "ELEMENT";
    const name = ctx.name || "";
    const subtext = name ? name : (ctx.id ? `#${ctx.id}` : (ctx.className ? `.${ctx.className.split(' ')[0]}` : tag));
    
    /**
     * What: Generate a preview body that handles both standard text, image previews, and file indicators.
     */
    let textHtml = text ? `<div class="preview-text-part">${escapeHtml(text.length > 500 ? text.substring(0, 500) + '...' : text)}</div>` : '';
    let mediaHtml = '';
    
    if (ctx.base64Images && ctx.base64Images.length > 0) {
      mediaHtml = '<div class="preview-images-container" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">';
      ctx.base64Images.forEach(img => {
        mediaHtml += `<img src="data:${img.mimeType};base64,${img.base64}" style="max-height: 100px; max-width: 100%; border-radius: 4px; object-fit: contain;" alt="Context Image" />`;
      });
      mediaHtml += '</div>';
    } else if (ctx.base64File) {
      mediaHtml = `<div class="file-indicator">
        📄 Attachment: ${escapeHtml(ctx.name)} (${ctx.type})
      </div>`;
    }
    
    let previewBodyHtml = `<div class="preview-body">${textHtml}${mediaHtml}</div>`;

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

// Handle actions (copy, edit, retry, canvas) via delegation on chat history
elements.chatHistory.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const canvasCard = e.target.closest('.canvas-trigger-card');

  if (canvasCard) {
    const title = canvasCard.getAttribute('data-title');
    const html = canvasCard.getAttribute('data-html');
    openCanvas(title, html);
    return;
  }

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

function unescapeHtml(html) {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

function openCanvas(title, html) {
  elements.canvasTitle.innerText = title;
  
  let content = unescapeHtml(html);
  
  /**
   * What: Injecting local Tailwind CSS JIT engine.
   * Why: This allows the AI to use Tailwind classes without violating 
   *      Content Security Policy (CSP), as the script is bundled locally.
   */
  const tailwindUrl = chrome.runtime.getURL('lib/tailwind.min.js');
  const tailwindScript = `<script src="${tailwindUrl}"></script>`;
  
  if (content.includes('</head>')) {
    content = content.replace('</head>', `${tailwindScript}</head>`);
  } else if (content.includes('<body>')) {
    content = content.replace('<body>', `<body>${tailwindScript}`);
  } else {
    content = tailwindScript + content;
  }

  elements.canvasFrame.srcdoc = content;
  elements.canvasContainer.classList.remove('hidden');
}

function closeCanvas() {
  elements.canvasContainer.classList.add('hidden');
  elements.exportMenu.parentElement.classList.remove('show');
  // Clear srcdoc after animation to free memory
  setTimeout(() => {
    elements.canvasFrame.srcdoc = '';
  }, 500);
}

function exportPdf() {
  const html = elements.canvasFrame.srcdoc;
  const title = elements.canvasTitle.innerText;
  
  /**
   * What: Injecting print-specific styles and a print trigger script.
   * Why: User requested Times New Roman 12pt and for content to 
   *      ideally fit on one page. @media print CSS is the standard way 
   *      to override screen styles for PDF generation.
   */
  const printAdditions = `
    <style>
      @media print {
        @page {
          margin: 15mm;
          size: portrait;
        }
        body {
          font-family: "Times New Roman", Times, serif !important;
          font-size: 12pt !important;
          color: #000 !important;
          background: #fff !important;
          line-height: 1.4 !important;
          margin: 0 !important;
        }
        /* Ensure all elements inherit the print font */
        * {
          font-family: "Times New Roman", Times, serif !important;
        }
        /* Common containers that might restrict height */
        html, body {
          height: auto !important;
          overflow: visible !important;
        }
        /* Avoid page breaks inside sections if possible */
        section, div, p {
          break-inside: avoid;
        }
      }
    </style>
    <script>
      window.onload = () => {
        setTimeout(() => {
          window.print();
        }, 500);
      };
    </script>
  `;
  
  let finalHtml = html;
  if (finalHtml.includes('</head>')) {
    finalHtml = finalHtml.replace('</head>', `${printAdditions}</head>`);
  } else if (finalHtml.includes('<body>')) {
    finalHtml = finalHtml.replace('<body>', `<body>${printAdditions}`);
  } else {
    finalHtml = printAdditions + finalHtml;
  }
  
  const blob = new Blob([finalHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

function exportDoc() {
  const html = elements.canvasFrame.srcdoc;
  const title = elements.canvasTitle.innerText;
  
  // Basic MS Word compatible HTML wrapper
  const docHtml = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>${title}</title></head>
    <body>${html}</body>
    </html>
  `;
  
  const blob = new Blob([docHtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/\s+/g, '_')}.doc`;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportPng() {
  const frame = elements.canvasFrame;
  const title = elements.canvasTitle.innerText;

  try {
    showToast("Capturing image...");
    
    // We attempt to capture the iframe content via a canvas.
    // Since it's srcdoc (local), we can access the document.
    const frameDoc = frame.contentDocument || frame.contentWindow.document;
    const body = frameDoc.body;
    
    // Using a simplified approach: render the HTML to a canvas if possible.
    // In a real browser extension, we might use chrome.tabs.captureVisibleTab 
    // but for the sidepanel, we'll try a SVG-based foreignObject capture.
    
    const width = body.scrollWidth || 800;
    const height = body.scrollHeight || 600;
    
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            ${frameDoc.documentElement.innerHTML}
          </div>
        </foreignObject>
      </svg>
    `;
    
    const img = new Image();
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = "white"; // Default background
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      
      const pngUrl = canvas.toDataURL("image/png");
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `${title.replace(/\s+/g, '_')}.png`;
      link.click();
      URL.revokeObjectURL(url);
      showToast("Image exported!");
    };
    
    img.onerror = () => {
      showToast("Manual screenshot recommended for complex apps.");
      URL.revokeObjectURL(url);
    };
    
    img.src = url;
  } catch (e) {
    console.error("PNG export failed:", e);
    showToast("Failed to capture image.");
  }
}

function exportHtml() {
  const html = elements.canvasFrame.srcdoc;
  const title = elements.canvasTitle.innerText;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/\s+/g, '_')}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

// Event Listeners for Export Menu
elements.downloadBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  elements.exportMenu.parentElement.classList.toggle('show');
});

// Close menu when clicking outside
document.addEventListener('click', () => {
  elements.exportMenu.parentElement.classList.remove('show');
});

elements.exportPdfBtn.addEventListener('click', exportPdf);
elements.exportDocBtn.addEventListener('click', exportDoc);
elements.exportPngBtn.addEventListener('click', exportPng);
elements.exportHtmlBtn.addEventListener('click', exportHtml);

elements.closeCanvasBtn.addEventListener('click', closeCanvas);

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

