/**
 * main.js
 * Application entry point. Orchestrates initialization, 
 * event delegation, and the core message loop.
 */

import {
  state,
  loadSettings,
  saveSettings,
  saveTabsToStorage,
  saveUsageToStorage
} from './state.js';
import { buildPrompt } from './prompts.js';
import { getAIProvider } from './api.js';
import { elements, applyTheme, applyThemeColor, smartScroll, showToast, scrollToBottom, escapeHtml } from './ui.js';
import {
  appendMessage,
  appendStreamingMessage,
  appendProgressMessage,
  showWelcomeMessage,
  renderCharts,
  renderDiagrams,
  clearWelcomeCard
} from './chat.js';
import { VideoProcessor, VideoAnalysisModal } from './video.js';
import { initDB, listMedia, deleteMedia, getMedia, getStorageStats } from './mediaStore.js';
import { speakText, stopSpeech } from './tts.js';

// --- Global State Extension ---
state.tasks = []; // Active background processing tasks
state.notifications = []; // User notifications


// --- Initialization ---

/** Loads user settings and conversation history on startup. */
loadSettings((loadedState) => {
  if (loadedState.userApiKey) elements.apiKeyInput.value = loadedState.userApiKey;
  if (loadedState.gcloudApiKey) elements.gcloudApiKeyInput.value = loadedState.gcloudApiKey;
  if (loadedState.gcloudRegion) elements.gcloudRegionInput.value = loadedState.gcloudRegion;
  if (loadedState.gcloudProjectId) elements.gcloudProjectIdInput.value = loadedState.gcloudProjectId;
  if (loadedState.ttsModel) elements.ttsModelSelect.value = loadedState.ttsModel;
  if (loadedState.userModel) elements.modelNameSelect.value = loadedState.userModel;
  if (loadedState.userTheme) {
    elements.themeSelect.value = loadedState.userTheme;
    applyTheme(loadedState.userTheme);
  }
  if (loadedState.userThemeColor) {
    elements.themeColorInput.value = loadedState.userThemeColor;
    applyThemeColor(loadedState.userThemeColor);
  }

  // Initialize Persistent Media Store
  initDB().catch(err => console.error("Failed to init MediaStore:", err));

  renderTabs();
  updateUsageHeader();
  const activeTab = getActiveTab();
  if (activeTab && activeTab.history.length > 0) {
    reconstructChatFromHistory();
    renderContextChips();
  } else {
    showWelcomeMessage();
  }
});

window.addEventListener('task-updated', renderTabs);
window.addEventListener('media-updated', () => {
  MediaLibraryModal.refresh();
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
    const hasActiveTask = state.tasks.some(task => task.id.toString().startsWith(tab.id.substring(0, 5)) || tab.history.some(m => m.type === 'task'));
    // Simplified: Check if any history message is still a 'task'
    const isActiveProcessing = tab.history.some(m => m.type === 'task');

    if (isActiveProcessing) {
      tabEl.classList.add('has-task');
    }

    tabEl.innerHTML = `
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <div class="task-badge"></div>
      <span class="close-tab" data-id="${tab.id}">&times;</span>
    `;

    const titleSpan = tabEl.querySelector('.tab-title');

    // Switch tab on click
    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('close-tab') && !tabEl.classList.contains('editing')) {
        switchTab(tab.id);
      }
    });

    // Rename on double click
    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (tabEl.classList.contains('editing')) return;

      tabEl.classList.add('editing');
      const originalTitle = tab.title;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tab-edit-input';
      input.value = originalTitle;

      const saveRename = () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== originalTitle) {
          tab.title = newTitle;
          saveTabsToStorage();
        }
        renderTabs();
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveRename();
        if (e.key === 'Escape') renderTabs();
      });

      input.addEventListener('blur', saveRename);

      titleSpan.innerHTML = '';
      titleSpan.appendChild(input);
      input.focus();
      input.select();
    });

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

    let finalUsage = null;
    for await (const chunk of stream) {
      if (chunk.text) {
        accumulatedText += chunk.text;
        streaming.update(accumulatedText);
      }
      if (chunk.usage) {
        finalUsage = chunk.usage;
      }
    }

    // Process Usage Metadata
    if (finalUsage) {
      state.usage.promptTokens += (finalUsage.promptTokenCount || 0);
      state.usage.candidatesTokens += (finalUsage.candidatesTokenCount || 0);
      state.usage.totalTokens += (finalUsage.totalTokenCount || 0);
      saveUsageToStorage();
      updateUsageHeader();
    }

    streaming.finalize(accumulatedText, finalUsage);
    currentTab.history.push({
      role: "model",
      parts: [{ text: accumulatedText }],
      usage: finalUsage
    });
    saveTabsToStorage();

    // Autoplay if the message contains a TTS player
    const lastMessage = elements.chatHistory.lastElementChild;
    if (lastMessage) {
      const player = lastMessage.querySelector('.tts-player');
      if (player) {
        // Short delay to ensure DOM is ready and it feels natural
        setTimeout(() => toggleTTSPlayer(player), 500);
      }
    }

  } catch (error) {
    if (streaming) {
      streaming.finalize("");
    }
    showToast(`Note: ${error.message}`);
    appendMessage('AI', `<div class="error-bubble"><b>Hold on a moment:</b> ${error.message}</div>`);
  }
}

/** Updates the cumulative token usage display in the app header. */
function updateUsageHeader() {
  const headerUsage = document.getElementById('headerUsage');
  if (headerUsage) {
    const totalK = (state.usage.totalTokens / 1000).toFixed(1);
    headerUsage.innerText = `${totalK}k Tokens`;
    headerUsage.title = `Prompt: ${state.usage.promptTokens} | Response: ${state.usage.candidatesTokens} | Total: ${state.usage.totalTokens}`;
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
    if (msg.type === 'task') {
      appendProgressMessage(msg.sender, msg.taskName, msg.videoData, msg.taskId, currentTab.id);
    } else {
      const isUser = msg.role === 'user';
      const content = isUser ? extractUserQuestion(msg.parts[0].text) : msg.parts[0].text;
      appendMessage(isUser ? 'user' : 'AI', marked.parse(content), index, msg.videoData, msg.usage);
    }
  });
  scrollToBottom();
}

/** Webcam Management */
const WebcamModal = {
  stream: null,
  mediaRecorder: null,
  chunks: [],

  async open() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      elements.webcamPreview.srcObject = this.stream;
      elements.webcamPreview.classList.add('mirrored');
      elements.mirrorWebcamBtn.classList.add('active');
      elements.webcamModal.classList.remove('hidden');
    } catch (err) {
      console.error("Webcam access error:", err);
      let errorMsg = "Camera access denied or not found.";

      if (err.name === 'NotAllowedError') {
        errorMsg = "Permission denied. Chrome often hides the prompt in the sidepanel. Click 'Grant Permissions' to open a tab and allow access.";
        // Optionally show a specific button to grant permission
        showToast(errorMsg);
        if (confirm("Chrome often blocks camera prompts in the sidepanel. Would you like to open a full tab to grant permissions once?")) {
          chrome.tabs.create({ url: 'sidepanel.html' });
        }
      } else if (err.name === 'NotFoundError') {
        errorMsg = "No camera found. Please ensure your webcam is connected or use the 'Upload File' button to analyze a video instead.";
        showToast(errorMsg);
      } else {
        showToast(`Camera Error: ${err.message || err.name}`);
      }
    }
  },

  close() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    elements.webcamPreview.srcObject = null;
    elements.webcamModal.classList.add('hidden');
    this.updateRecordingUI(false);
  },

  async toggleRecording() {
    if (!this.stream) return;

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      return;
    }

    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'video/webm' });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(this.chunks, { type: 'video/webm' });
      const file = new File([blob], `webcam-${Date.now()}.webm`, { type: 'video/webm' });
      this.close();

      VideoAnalysisModal.show(file);
      const options = await VideoAnalysisModal.getOptions();
      if (options.action === 'analyze') {
        startVideoAnalysis(file, { resolution: options.resolution, fps: options.fps }, options.promptText);
      }
    };

    this.mediaRecorder.start();
    this.updateRecordingUI(true);

    // Start Timer
    let seconds = 0;
    elements.webcamTimer.innerText = "00:00";
    this.timerInterval = setInterval(() => {
      seconds++;
      const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
      const secs = (seconds % 60).toString().padStart(2, '0');
      elements.webcamTimer.innerText = `${mins}:${secs}`;
    }, 1000);

    // Auto-stop after 30 seconds max
    setTimeout(() => {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
    }, 30000);
  },

  async captureFrame() {
    if (!this.stream) return;
    const canvas = document.createElement('canvas');
    canvas.width = elements.webcamPreview.videoWidth;
    canvas.height = elements.webcamPreview.videoHeight;
    const ctx = canvas.getContext('2d');

    // Mirror the capture to match the preview
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(elements.webcamPreview, 0, 0);

    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    const dataUrl = await new Promise(r => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result);
      reader.readAsDataURL(blob);
    });

    this.close();
    addContext({
      tag: 'WEBCAM_FRAME',
      images: [{ src: dataUrl, alt: 'Webcam snapshot' }]
    });
    showToast("Webcam frame captured!");
  },

  updateRecordingUI(isRecording) {
    if (isRecording) {
      elements.recordStatus.classList.remove('hidden');
      elements.startRecordingBtn.innerText = "Stop Recording";
      elements.startRecordingBtn.classList.add('recording');
    } else {
      elements.recordStatus.classList.add('hidden');
      elements.startRecordingBtn.innerText = "Start Recording";
      elements.startRecordingBtn.classList.remove('recording');
    }
  }
};

/** Media Library Management - Unified Local & Cloud */
const MediaLibraryModal = {
  items: [],
  cloudItems: [],
  currentMedia: null,
  activeTab: 'local',

  async open() {
    elements.mediaLibraryModal.classList.remove('hidden');
    await this.refresh();
  },

  close() {
    elements.mediaLibraryModal.classList.add('hidden');
    elements.librarySearch.value = '';
    // Pause all playing videos to release resources
    document.querySelectorAll('.feed-video').forEach(video => {
      video.pause();
      if (video.src) URL.revokeObjectURL(video.src);
    });
  },

  async refresh() {
    if (this.activeTab === 'local') {
      this.items = await listMedia();
    } else {
      await this.fetchCloudItems();
    }
    this.render();
    this.updateStats();
  },

  async fetchCloudItems() {
    if (!state.userApiKey) {
      this.cloudItems = [];
      return;
    }
    try {
      const provider = getAIProvider(state.userModel);
      this.cloudItems = await provider.listFiles(state.userApiKey);
    } catch (err) {
      console.error("Cloud Fetch Failed:", err);
      showToast('Failed to load cloud files.');
    }
  },

  async updateStats() {
    const stats = await getStorageStats();
    if (this.activeTab === 'local') {
      elements.libraryStats.innerText = `${stats.itemCount} clips total`;
    } else {
      elements.libraryStats.innerText = `${this.cloudItems.length} cloud assets`;
    }
  },

  render(filter = '') {
    const listToRender = this.activeTab === 'local' ? this.items : this.cloudItems;

    const filtered = listToRender.filter(item => {
      const name = item.name || item.displayName || item.id || '';
      return name.toLowerCase().includes(filter.toLowerCase());
    });

    if (filtered.length === 0) {
      elements.mediaGrid.innerHTML = `
        <div class="empty-studio">
          <p>${filter ? 'No results found.' : 'Studio is empty.'}</p>
        </div>
      `;
      return;
    }

    elements.mediaGrid.innerHTML = filtered.map(item => {
      const isLocal = this.activeTab === 'local';
      const id = isLocal ? item.id : item.uri;
      const name = isLocal ? (item.name || item.id) : (item.displayName || id.split('/').pop());
      const size = isLocal ? (item.size / 1024 / 1024).toFixed(1) : (item.sizeBytes / 1024 / 1024).toFixed(1);
      const date = isLocal ? new Date(item.timestamp).toLocaleDateString() : 'Gemini Cloud';

      return `
        <div class="feed-card" data-id="${id}">
          <div class="feed-video-container">
            ${isLocal
          ? `<video class="feed-video" loop muted data-local-id="${id}" poster="img/video-placeholder.png"></video>`
          : `
                <div class="video-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <p>Cloud Asset</p>
                </div>
              `
        }
            <div class="feed-card-overlay">
              <div class="overlay-top">
                <div class="feed-asset-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                ${!isLocal ? '<span class="cloud-badge-studio">Cloud</span>' : ''}
              </div>
              <div class="overlay-bottom">
                <div class="feed-asset-meta">
                  <span>${date}</span>
                  <span>•</span>
                  <span>${size}MB</span>
                </div>
                <div class="feed-card-controls">
                  <div class="video-seeker">
                    <div class="seeker-track">
                      <div class="seeker-fill"></div>
                    </div>
                  </div>
                  <div class="control-row">
                    <div class="left-controls">
                      <button class="studio-btn control-btn play-pause-btn" title="Play/Pause">
                        <svg class="play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"></path></svg>
                        <svg class="pause-icon hidden" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                      </button>
                      <button class="studio-btn control-btn mute-btn" title="Mute/Unmute">
                        <svg class="volume-up-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                        <svg class="volume-mute-icon hidden" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                      </button>
                      <div class="divisor"></div>
                      <button class="studio-btn control-btn filter-btn" data-filter="grayscale" title="Grayscale">G</button>
                      <button class="studio-btn control-btn filter-btn" data-filter="contrast" title="Contrast">C</button>
                      <button class="studio-btn control-btn filter-btn" data-filter="brightness" title="Brightness">B</button>
                    </div>
                    <div class="right-controls">
                      <button class="studio-btn control-btn download-btn" title="Download">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                      </button>
                      <button class="studio-btn primary analyze-btn" ${!isLocal ? 'disabled' : ''} title="Analyze">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                        </svg>
                      </button>
                      <button class="studio-btn danger delete-btn" title="Delete Asset">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <path d="M3 6h18"></path>
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach hover listeners for autoplay
    document.querySelectorAll('.feed-card').forEach(card => {
      const video = card.querySelector('.feed-video');
      if (!video) return;

      const ppBtn = card.querySelector('.play-pause-btn');
      const muteBtn = card.querySelector('.mute-btn');
      const seekerFill = card.querySelector('.seeker-fill');

      video.addEventListener('play', () => {
        ppBtn.querySelector('.play-icon').classList.add('hidden');
        ppBtn.querySelector('.pause-icon').classList.remove('hidden');
      });
      video.addEventListener('pause', () => {
        ppBtn.querySelector('.play-icon').classList.remove('hidden');
        ppBtn.querySelector('.pause-icon').classList.add('hidden');
      });
      video.addEventListener('volumechange', () => {
        if (video.muted) {
          muteBtn.querySelector('.volume-up-icon').classList.add('hidden');
          muteBtn.querySelector('.volume-mute-icon').classList.remove('hidden');
        } else {
          muteBtn.querySelector('.volume-up-icon').classList.remove('hidden');
          muteBtn.querySelector('.volume-mute-icon').classList.add('hidden');
        }
      });
      video.addEventListener('timeupdate', () => {
        const progress = (video.currentTime / video.duration) * 100;
        seekerFill.style.width = `${progress}%`;
      });

      card.addEventListener('mouseenter', () => video.play().catch(() => { }));
      card.addEventListener('mouseleave', () => {
        video.pause();
        video.currentTime = 0;
      });
    });

    if (this.activeTab === 'local') {
      this.loadFeedVideos();
    }
  },

  async loadFeedVideos() {
    const videos = document.querySelectorAll('.feed-video[data-local-id]');
    for (const video of videos) {
      const id = video.getAttribute('data-local-id');
      const blob = await getMedia(id);
      if (blob) {
        // Prevent memory leak by checking if src already exists
        if (!video.src) video.src = URL.createObjectURL(blob);
      }
    }
  },

  async handleAction(e) {
    const card = e.target.closest('.feed-card');
    if (!card) return;
    const id = card.getAttribute('data-id');

    const deleteBtn = e.target.closest('.delete-btn');
    const analyzeBtn = e.target.closest('.analyze-btn');
    const mirrorBtn = e.target.closest('.mirror-btn');

    if (deleteBtn) {
      e.stopPropagation();
      if (confirm(`Delete this asset permanently?`)) {
        try {
          if (this.activeTab === 'local') {
            await deleteMedia(id);
          } else {
            const provider = getAIProvider(state.userModel);
            await provider.deleteFile(state.userApiKey, id);
          }
          await this.refresh();
          showToast('Asset deleted.');
        } catch (err) {
          showToast('Failed to delete asset.');
        }
      }
    } else if (analyzeBtn && !analyzeBtn.disabled) {
      // Trigger Analysis Flow directly
      if (this.activeTab === 'local') {
        const item = this.items.find(i => i.id === id);
        if (item) {
          const blob = await getMedia(id);
          if (blob) {
            const file = new File([blob], `${item.name || id}.webm`, { type: blob.type });
            this.close();
            VideoAnalysisModal.show(file);
            const options = await VideoAnalysisModal.getOptions();
            if (options.action === 'analyze') {
              startVideoAnalysis(file, { resolution: options.resolution, fps: options.fps }, options.promptText);
            }
          }
        }
      }
    } else if (mirrorBtn) {
      const video = card.querySelector('.feed-video');
      if (video) {
        video.classList.toggle('mirrored');
        mirrorBtn.classList.toggle('active');
      }
    } else if (e.target.closest('.play-pause-btn')) {
      const video = card.querySelector('.feed-video');
      if (video) {
        if (video.paused) video.play();
        else video.pause();
      }
    } else if (e.target.closest('.mute-btn')) {
      const video = card.querySelector('.feed-video');
      if (video) video.muted = !video.muted;
    } else if (e.target.closest('.filter-btn')) {
      const btn = e.target.closest('.filter-btn');
      const filter = btn.getAttribute('data-filter');
      const video = card.querySelector('.feed-video');
      if (video) {
        video.classList.toggle(`video-filter-${filter}`);
        btn.classList.toggle('active');
      }
    } else if (e.target.closest('.download-btn')) {
      const video = card.querySelector('.feed-video');
      if (video && video.src) {
        const a = document.createElement('a');
        a.href = video.src;
        a.download = `clip-${id}.webm`;
        a.click();
      }
    } else if (e.target.closest('.video-seeker')) {
      const seeker = e.target.closest('.video-seeker');
      const video = card.querySelector('.feed-video');
      if (video && video.duration) {
        const rect = seeker.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        video.currentTime = pos * video.duration;
      }
    }
  },

  setTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.lib-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    this.refresh();
  }
};

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
elements.extractPdfBtn.addEventListener('click', extractCurrentPagePdf);
elements.webcamBtn.addEventListener('click', () => WebcamModal.open());
elements.uploadBtn.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', handleFileSelect);

// Webcam Modal Listeners
elements.closeWebcamBtn.addEventListener('click', () => WebcamModal.close());
elements.startRecordingBtn.addEventListener('click', () => WebcamModal.toggleRecording());
elements.captureFrameBtn.addEventListener('click', () => WebcamModal.captureFrame());
elements.mirrorWebcamBtn.addEventListener('click', () => {
  elements.webcamPreview.classList.toggle('mirrored');
  elements.mirrorWebcamBtn.classList.toggle('active');
});

// Media Library Listeners
elements.openLibraryBtn.addEventListener('click', () => MediaLibraryModal.open());
elements.closeLibraryBtn.addEventListener('click', () => MediaLibraryModal.close());
elements.mediaGrid.addEventListener('click', (e) => MediaLibraryModal.handleAction(e));
elements.librarySearch.addEventListener('input', (e) => MediaLibraryModal.render(e.target.value));
document.querySelectorAll('.lib-tab').forEach(btn => {
  btn.addEventListener('click', () => MediaLibraryModal.setTab(btn.getAttribute('data-tab')));
});

// Settings Save Logic
elements.saveSettingsBtn.addEventListener('click', () => {
  saveSettings(
    elements.apiKeyInput.value,
    elements.modelNameSelect.value,
    elements.themeSelect.value,
    elements.themeColorInput.value,
    elements.gcloudApiKeyInput.value,
    elements.gcloudRegionInput.value,
    elements.gcloudProjectIdInput.value,
    elements.ttsModelSelect.value
  );
  elements.settingsOverlay.classList.add('hidden');
  showToast("Settings saved successfully.");
});

/**
 * Enhanced file selector to handle Video optimization and 
 * Background analysis triggers.
 */
async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  setExtractionLoading(true);
  try {
    for (const file of files) {
      if (file.type.startsWith('video/')) {
        setExtractionLoading(false);
        VideoAnalysisModal.show(file);
        const options = await VideoAnalysisModal.getOptions();

        if (options.action === 'analyze') {
          startVideoAnalysis(file, { resolution: options.resolution, fps: options.fps }, options.promptText);
        }
        continue;
      } else {
        await processFile(file);
      }
    }
  } finally {
    setExtractionLoading(false);
    elements.fileInput.value = ''; // Reset for same-file re-uploads
  }
}

/**
 * Core Orchestrator for Background Video Analysis.
 */
async function startVideoAnalysis(file, choice, userPrompt) {
  const taskId = Date.now().toString();
  const tabId = state.activeTabId;
  const currentTab = state.tabs.find(t => t.id === tabId);

  // 1. Create a progress message in the chat with a video preview
  let videoData = null;
  if (file.src) {
    videoData = { src: file.src, type: file.type };
  } else {
    videoData = { src: URL.createObjectURL(file), type: file.type, file: file };
  }

  // 0. Show the user's prompt in the chat history
  const displayPrompt = userPrompt || "Analyze this video with the specified settings.";
  const userIndex = currentTab.history.length;
  appendMessage('user', displayPrompt, userIndex, { ...videoData });
  currentTab.history.push({ role: 'user', parts: [{ text: displayPrompt }], videoData: { ...videoData } });

  const task = {
    id: taskId,
    tabId: tabId,
    name: `Analyzing ${file.name}`,
    status: 'starting',
    progress: 0
  };
  state.tasks.push(task);
  renderTabs(); // Show badge

  const progressUpdater = appendProgressMessage('AI', task.name, videoData, taskId, tabId);

  try {
    const provider = getAIProvider(state.userModel);
    let promptParts = [];

    if (choice.action === 'analyze' && choice.resolution !== 'original') {
      // Path A: Project as Image Sequence (Optimization)
      progressUpdater.update(10, `Extracting frames at ${choice.fps} FPS...`);
      const frames = await VideoProcessor.extractFrames(file, choice.fps, parseInt(choice.resolution) || 480);

      progressUpdater.update(80, 'Preparing analysis prompt...');
      // Gemini 1.5/2.x/3.x handles a list of images as a video sequence
      promptParts = [
        ...frames.map(f => ({ inline_data: { mime_type: f.mimeType, data: f.base64 } })),
        { text: `The preceding images are frames from a video taken at ${choice.fps} FPS. ${userPrompt}` }
      ];
    } else {
      // Path B: Upload Original (File API)
      progressUpdater.update(10, 'Initializing secure upload...');
      const uploadedFile = await provider.uploadFile(state.userApiKey, file, (p) => {
        const uploadProgress = 10 + (p * 0.7); // 10% to 80%
        progressUpdater.update(Math.round(uploadProgress), `Uploading... ${p}%`);
      });

      progressUpdater.update(85, 'AI is processing video content...');
      let status = 'PROCESSING';
      while (status === 'PROCESSING') {
        await new Promise(r => setTimeout(r, 4000));
        const fileInfo = await provider.getFileStatus(state.userApiKey, uploadedFile.uri);
        status = fileInfo.state;
        if (status === 'FAILED') throw new Error("Gemini File API processing failed.");
      }

      promptParts = [
        { file_data: { mime_type: uploadedFile.mimeType, file_uri: uploadedFile.uri } },
        { text: userPrompt }
      ];
    }

    // 5. Analysis Phase (Generate Content)
    progressUpdater.update(95, 'Generating final analysis...');
    const stream = provider.streamGenerateContent(
      state.userApiKey,
      state.userModel,
      [],
      promptParts
    );

    let resultText = '';
    let finalUsage = null;
    for await (const chunk of stream) {
      if (chunk.text) {
        resultText += chunk.text;
      }
      if (chunk.usage) {
        finalUsage = chunk.usage;
      }
    }

    // Update state usage
    if (finalUsage) {
      state.usage.promptTokens += (finalUsage.promptTokenCount || 0);
      state.usage.candidatesTokens += (finalUsage.candidatesTokenCount || 0);
      state.usage.totalTokens += (finalUsage.totalTokenCount || 0);
      saveUsageToStorage();
      updateUsageHeader();
    }

    // 6. Completion
    progressUpdater.finalize(resultText, finalUsage);
    addNotification(`Analysis Complete: ${file.name}`, 'success');

  } catch (err) {
    progressUpdater.error(err.message);
    addNotification(`Analysis Failed: ${file.name}`, 'error');
  } finally {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
  }
}

/** Notification Management */
function addNotification(message, type) {
  const notification = { id: Date.now(), message, type, read: false, time: new Date() };
  state.notifications.unshift(notification);
  renderNotifications();
  showToast(message);
}

function renderNotifications() {
  const unreadCount = state.notifications.filter(n => !n.read).length;
  elements.notificationBadge.innerText = unreadCount;
  elements.notificationBadge.classList.toggle('hidden', unreadCount === 0);

  elements.notificationList.innerHTML = state.notifications.length === 0
    ? '<div class="empty-notifications">No new notifications.</div>'
    : state.notifications.map(n => `
        <div class="notification-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
          <div class="notification-msg"><b>${n.type.toUpperCase()}:</b> ${escapeHtml(n.message)}</div>
          <div class="notification-time">${n.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      `).join('');
}

elements.notificationBtn.addEventListener('click', () => {
  elements.notificationPopover.classList.toggle('hidden');
  if (!elements.notificationPopover.classList.contains('hidden')) {
    state.notifications.forEach(n => n.read = true);
    renderNotifications();
  }
});

elements.clearNotificationsBtn.addEventListener('click', () => {
  state.notifications = [];
  renderNotifications();
});

// Close popover on click outside
document.addEventListener('click', (e) => {
  if (!elements.notificationBtn.contains(e.target) && !elements.notificationPopover.contains(e.target)) {
    elements.notificationPopover.classList.add('hidden');
  }
});

/**
 * What: Detects if the current tab is a PDF or contains an embedded PDF and extracts it.
 * Why: Allows users to quickly get PDF context without triggering full element extraction.
 */
async function extractCurrentPagePdf() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab) return;

    const url = tab.url.toLowerCase();

    // 1. Direct PDF Page or common PDF-serving patterns (like arXiv)
    const isDirectPdf = url.endsWith('.pdf') || url.includes('.pdf?');
    const isSpecializedViewer = url.includes('/pdf/') || url.includes('type=pdf') || url.includes('/viewer.html?file=');

    if (isDirectPdf || isSpecializedViewer) {
      const fileName = url.split('/').pop().split('?')[0] || 'document.pdf';
      addContext({
        pdfUrl: tab.url,
        pdfName: fileName,
        tag: 'PDF'
      });
      return;
    }

    // 2. Embedded PDF scanning via content script
    sendMessageToTab(tab.id, { type: 'GET_PAGE_PDFS' }, (response) => {
      if (response && response.pdfUrl) {
        addContext({
          pdfUrl: response.pdfUrl,
          pdfName: response.pdfName,
          tag: 'PDF'
        });
      } else {
        showToast("No embedded PDF found on this page.");
      }
    });
  });
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
  updateExtractionUI();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      sendMessageToTab(tabs[0].id, {
        type: state.isExtracting ? "START_SELECTION" : "STOP_SELECTION"
      });
    }
  });
}

function updateExtractionUI() {
  elements.extractBtn.classList.toggle('active', state.isExtracting);
  elements.inputWrapper.classList.toggle('extracting', state.isExtracting);
}

/** 
 * Sends a message to a specific tab with error handling for 
 * disconnected content scripts or restricted pages. 
 * Automatically attempts to inject the content script if missing.
 */
function sendMessageToTab(tabId, message, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      if (chrome.runtime.lastError) console.debug("Tab get error consumed:", chrome.runtime.lastError.message);
      return;
    }

    // Check for restricted URLs (tab.url might be undefined if no permission)
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
      showToast("Extraction not allowed on this page.");
      resetSelectionState();
      return;
    }

    const trySend = (isRetry = false) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          const errorMsg = error.message;
          if (errorMsg.includes("Receiving end does not exist") && !isRetry) {
            console.log("Extrapane: Content script missing, injecting...");
            injectAndRetry(tabId, message, callback);
          } else if (errorMsg.includes("message port closed before a response was received")) {
            // Silently reset state - port closed often during navigation or extension reload
            console.debug("Extrapane: Message port closed silently.");
            resetSelectionState();
          } else {
            console.warn("Extrapane: Could not connect to tab.", errorMsg);
            showToast("Please refresh the page to enable extraction.");
            resetSelectionState();
          }
        } else if (callback) {
          callback(response);
        }
      });
    };

    trySend();
  });
}

/** Injects content script and CSS into a tab and then retries the message. */
function injectAndRetry(tabId, message, callback) {
  chrome.scripting.insertCSS({
    target: { tabId: tabId },
    files: ['content.css']
  }, () => {
    if (chrome.runtime.lastError) console.debug("CSS insertion error consumed:", chrome.runtime.lastError.message);

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Extrapane: Failed to inject content script.", chrome.runtime.lastError.message);
        showToast("Access denied. Can't extract from this page.");
        resetSelectionState();
        return;
      }

      // Delay slightly to give content script time to initialize listeners
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) console.debug("Retry message error consumed:", chrome.runtime.lastError.message);
          if (callback) callback(response);
        });
      }, 100);
    });
  });
}

function resetSelectionState() {
  state.isExtracting = false;
  elements.extractBtn.classList.remove('active');
  elements.inputWrapper.classList.remove('extracting');
}

// Relay messages from content script
chrome.runtime.onMessage.addListener((request) => {
  switch (request.type) {
    case 'ELEMENT_SELECTED':
      addContext(request.data);
      break;
    case 'SELECTION_CANCELLED':
      state.isExtracting = false;
      elements.extractBtn.classList.remove('active');
      elements.inputWrapper.classList.remove('extracting');
      break;
  }
});

function setExtractionLoading(isLoading) {
  if (elements.extractionLoader) {
    elements.extractionLoader.classList.toggle('hidden', !isLoading);
  }
}

async function addContext(data) {
  const currentTab = getActiveTab();
  setExtractionLoading(true);

  try {
    // Handle Remote PDFs
    if (data.pdfUrl) {
      try {
        showToast(`Fetching PDF: ${data.pdfName}...`);
        const response = await fetch(data.pdfUrl);
        const blob = await response.blob();
        const base64Data = await fileToBase64(blob);

        data.base64File = {
          base64: base64Data.split(',')[1],
          mimeType: 'application/pdf'
        };
        data.name = data.pdfName;
        data.type = 'application/pdf';
        data.size = blob.size;
        data.tag = 'FILE';
      } catch (err) {
        console.error("Failed to fetch remote PDF:", err);
        showToast("Error: Could not fetch PDF URL.");
        return;
      }
    }

    // If the extracted element contains images, we need to convert them all to base64
    if (data.images && data.images.length > 0) {
      data.base64Images = [];
      for (const imgData of data.images) {
        try {
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
    }

    currentTab.contexts.push(data);
    saveTabsToStorage();
    renderContextChips();
  } catch (error) {
    console.error("Error adding context:", error);
    showToast("Error processing content.");
  } finally {
    setExtractionLoading(false);
  }
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

    // ADD Listen button if text exists
    let ttsBtnHtml = text ? `<button class="tts-btn" data-index="${index}" title="Listen to text">
          <svg class="tts-play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"></path></svg>
          <svg class="tts-stop-icon hidden" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        </button>` : '';

    chip.innerHTML = `
      <span class="chip-text"><b>${tag}</b> ${subtext}</span>
      <button class="remove-chip" data-index="${index}">&times;</button>
      <div class="context-preview">
        <div class="preview-header">
          <span class="preview-tag">${tag}</span>
          ${ctx.id ? `<span class="preview-id">#${ctx.id}</span>` : ''}
          ${ctx.className ? `<span class="preview-class">.${ctx.className.replace(/\s+/g, '.')}</span>` : ''}
          ${ttsBtnHtml}
        </div>
        ${previewBodyHtml}
      </div>
    `;
    elements.contextContainer.appendChild(chip);
  });
}

// Handle chip removal and TTS via delegation
elements.contextContainer.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.remove-chip');
  const ttsBtn = e.target.closest('.tts-btn');

  if (removeBtn) {
    const index = parseInt(removeBtn.getAttribute('data-index'));
    const currentTab = getActiveTab();
    currentTab.contexts.splice(index, 1);
    saveTabsToStorage();
    renderContextChips();
  }

  if (ttsBtn) {
    const index = parseInt(ttsBtn.getAttribute('data-index'));
    const currentTab = getActiveTab();
    const ctx = currentTab.contexts[index];

    if (!ctx || !ctx.text) return;

    const playIcon = ttsBtn.querySelector('.tts-play-icon');
    const stopIcon = ttsBtn.querySelector('.tts-stop-icon');
    const isPlaying = playIcon.classList.contains('hidden');

    // Reset all other TTS buttons first
    document.querySelectorAll('.tts-btn').forEach(btn => {
      btn.querySelector('.tts-play-icon').classList.remove('hidden');
      btn.querySelector('.tts-stop-icon').classList.add('hidden');
      btn.classList.remove('playing');
    });

    if (isPlaying) {
      stopSpeech();
    } else {
      ttsBtn.classList.add('playing');
      playIcon.classList.add('hidden');
      stopIcon.classList.remove('hidden');
      speakText(ctx.text, null, () => {
        // When speech ends
        playIcon.classList.remove('hidden');
        stopIcon.classList.add('hidden');
        ttsBtn.classList.remove('playing');
      });
    }
  }
});

/**
 * Handles the logic for the intelligent TTS player.
 * Manages playback state, animations, and controls.
 */
function toggleTTSPlayer(player, forceStop = false) {
  const text = player.getAttribute('data-text');
  const styling = player.getAttribute('data-styling');
  const playPauseBtn = player.querySelector('.play-pause-btn');
  const statusEl = player.querySelector('.tts-status');
  const isPlaying = player.classList.contains('playing');

  // Reset all other players first
  document.querySelectorAll('.tts-player').forEach(p => {
    if (p !== player) {
      p.classList.remove('playing');
      p.querySelector('.play-icon').classList.remove('hidden');
      p.querySelector('.pause-icon').classList.add('hidden');
      p.querySelector('.tts-status').innerText = 'Ready to play';
    }
  });

  if (forceStop || isPlaying) {
    stopSpeech();
    player.classList.remove('playing');
    playPauseBtn.querySelector('.play-icon').classList.remove('hidden');
    playPauseBtn.querySelector('.pause-icon').classList.add('hidden');
    statusEl.innerText = forceStop ? 'Ready to play' : 'Paused';
  } else {
    player.classList.add('playing');
    playPauseBtn.querySelector('.play-icon').classList.add('hidden');
    playPauseBtn.querySelector('.pause-icon').classList.remove('hidden');
    statusEl.innerText = 'Playing...';

    speakText(text, styling, () => {
      // On start (already handled by styling if needed)
    }, () => {
      // On end
      player.classList.remove('playing');
      playPauseBtn.querySelector('.play-icon').classList.remove('hidden');
      playPauseBtn.querySelector('.pause-icon').classList.add('hidden');
      statusEl.innerText = 'Finished';
    });
  }
}

// Handle actions (copy, edit, retry, canvas, tts-player) via delegation on chat history
elements.chatHistory.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const canvasCard = e.target.closest('.canvas-trigger-card');
  const ttsPlayer = e.target.closest('.tts-player');

  if (ttsPlayer && btn) {
    if (btn.classList.contains('play-pause-btn')) {
      toggleTTSPlayer(ttsPlayer);
    } else if (btn.classList.contains('stop-btn')) {
      toggleTTSPlayer(ttsPlayer, true);
    }
    return;
  }

  if (canvasCard) {
    const title = canvasCard.getAttribute('data-title');
    const html = canvasCard.getAttribute('data-html');
    openCanvas(title, html);
    return;
  }

  const collapseTrigger = e.target.closest('.collapse-trigger');
  if (collapseTrigger) {
    const collapseBox = collapseTrigger.closest('.context-collapse');
    collapseBox.classList.toggle('open');
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

  // If content doesn't seem to be HTML, parse it as Markdown
  if (!content.trim().startsWith('<')) {
    content = marked.parse(content);
  }

  const tailwindUrl = chrome.runtime.getURL('lib/tailwind.min.js');
  const isDark = document.body.classList.contains('dark-theme');

  const hljsJsUrl = chrome.runtime.getURL('lib/highlight.min.js');
  const hljsCssUrl = chrome.runtime.getURL(isDark ? 'lib/highlight-dark.min.css' : 'lib/highlight-light.min.css');

  const googleFonts = `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
  `;

  const baseStyle = `
    <link rel="stylesheet" href="${hljsCssUrl}">
    <style>
      :root {
        --canvas-bg: ${isDark ? '#0f111a' : '#ffffff'};
        --canvas-text: ${isDark ? '#e2e8f0' : '#1e293b'};
        --accent: #3b82f6;
        --border: ${isDark ? '#2d334a' : '#e2e8f0'};
        --card-bg: ${isDark ? '#1a1d2e' : '#f8fafc'};
      }
      body { 
        font-family: 'Inter', sans-serif; 
        line-height: 1.6; 
        color: var(--canvas-text); 
        background-color: var(--canvas-bg);
        margin: 0;
        padding: 24px 20px;
        max-width: 100%;
        box-sizing: border-box;
        word-wrap: break-word;
      }
      h1, h2, h3, h4 { 
        font-family: 'Outfit', sans-serif; 
        color: ${isDark ? '#f8fafc' : '#0f172a'};
        line-height: 1.25;
        margin-top: 2em;
        margin-bottom: 0.8em;
        font-weight: 700;
      }
      h1 { font-size: 2.2rem; letter-spacing: -0.02em; margin-top: 1em; }
      h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4em; }
      h3 { font-size: 1.25rem; }
      p { margin-bottom: 1.4em; }
      
      .alert { padding: 14px 16px; border-radius: 10px; margin: 1.5em 0; border: 1px solid transparent; display: flex; gap: 10px; font-size: 14px; }
      .alert-info { background: ${isDark ? '#1e293b' : '#eff6ff'}; border-color: ${isDark ? '#3b82f644' : '#bfdbfe'}; color: ${isDark ? '#93c5fd' : '#1e40af'}; }
      .alert-success { background: ${isDark ? '#064e3b' : '#ecfdf5'}; border-color: ${isDark ? '#10b98144' : '#a7f3d0'}; color: ${isDark ? '#6ee7b7' : '#065f46'}; }
      .alert-warning { background: ${isDark ? '#451a03' : '#fffbeb'}; border-color: ${isDark ? '#f59e0b44' : '#fef3c7'}; color: ${isDark ? '#fcd34d' : '#92400e'}; }
      
      .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; background: var(--card-bg); border: 1px solid var(--border); margin-right: 6px; }
      
      table { display: block; overflow-x: auto; white-space: nowrap; border-collapse: separate; border-spacing: 0; width: 100%; margin: 2em 0; border: 1px solid var(--border); border-radius: 12px; }
      th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); font-size: 14px; }
      th { background-color: var(--card-bg); font-weight: 600; color: ${isDark ? '#94a3b8' : '#64748b'}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
      tr:last-child td { border-bottom: none; }
      
      blockquote { font-size: 1em; line-height: 1.6; border-left: 3px solid var(--accent); padding: 4px 0 4px 16px; margin: 2em 0; color: ${isDark ? '#cbd5e1' : '#475569'}; font-style: italic; }
      img { max-width: 100%; border-radius: 12px; margin: 2em 0; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }
      
      pre { margin: 1.5em 0; border-radius: 10px; padding: 16px; font-size: 13px; overflow-x: auto; }
      code { font-family: 'JetBrains Mono', monospace; font-size: 0.9em; padding: 0.2em 0.4em; background: rgba(128,128,128,0.1); border-radius: 4px; }
      pre code { padding: 0; background: transparent; font-size: 13px; }
      hr { border: 0; border-top: 1px solid var(--border); margin: 3em 0; }
    </style>
  `;

  const tailwindScript = `<script src="${tailwindUrl}"></script>`;
  const hljsScript = `<script src="${hljsJsUrl}"></script><script>window.onload=()=>{if(window.hljs)hljs.highlightAll();};</script>`;
  const injections = googleFonts + baseStyle + tailwindScript + hljsScript;

  if (content.includes('</head>')) {
    content = content.replace('</head>', `${injections}</head>`);
  } else if (content.includes('<body>')) {
    content = content.replace('<body>', `<body>${injections}`);
  } else {
    content = injections + content;
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

function closeAndRevertSettings() {
  // Revert preview if not saved
  applyTheme(state.userTheme);
  applyThemeColor(state.userThemeColor);
  elements.settingsOverlay.classList.add('hidden');
}

// Close menu and popovers when clicking outside
document.addEventListener('click', (e) => {
  elements.exportMenu.parentElement.classList.remove('show');

  if (!elements.settingsOverlay.classList.contains('hidden') &&
    !elements.settingsOverlay.contains(e.target) &&
    !elements.settingsBtn.contains(e.target)) {
    closeAndRevertSettings();
  }
});

elements.exportPdfBtn.addEventListener('click', exportPdf);
elements.exportDocBtn.addEventListener('click', exportDoc);
elements.exportPngBtn.addEventListener('click', exportPng);
elements.exportHtmlBtn.addEventListener('click', exportHtml);

elements.closeCanvasBtn.addEventListener('click', closeCanvas);

// Settings Overlay Management
elements.settingsBtn.addEventListener('click', () => {
  elements.themeSelect.value = state.userTheme;
  elements.themeColorInput.value = state.userThemeColor;
  elements.settingsOverlay.classList.remove('hidden');
});

elements.closeSettingsBtn.addEventListener('click', closeAndRevertSettings);

// Add real-time preview listeners
elements.themeSelect.addEventListener('change', (e) => applyTheme(e.target.value));
elements.themeColorInput.addEventListener('input', (e) => applyThemeColor(e.target.value));

elements.saveSettingsBtn.addEventListener('click', () => {
  saveSettings(
    elements.apiKeyInput.value,
    elements.modelNameSelect.value,
    elements.themeSelect.value,
    elements.themeColorInput.value
  );
  applyTheme(state.userTheme);
  applyThemeColor(state.userThemeColor);
  elements.settingsOverlay.classList.add('hidden');
  showToast('Settings saved!');
});

elements.settingsBtn.addEventListener('click', () => {
  // Opening the settings modal is handled by CSS/HTML structure or common logic
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

