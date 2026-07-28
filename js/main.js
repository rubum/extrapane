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
import { buildPrompt, getSystemInstructions } from './prompts.js';
import { getAIProvider } from './api.js';
import { elements, applyTheme, applyThemeColor, smartScroll, showToast, scrollToBottom, escapeHtml } from './ui.js';
import {
  appendMessage,
  appendStreamingMessage,
  appendProgressMessage,
  showWelcomeMessage,
  renderCharts,
  renderDiagrams,
  clearWelcomeCard,
  preprocessResponse,
  appendGitHubSelectorMessage,
  setInlineQuestionCallback,
  renderSubConversationBox
} from './chat.js';
import { VideoProcessor, VideoAnalysisModal } from './video.js';
import { AudioAnalysisModal } from './audio.js';
import { initDB, listMedia, deleteMedia, getMedia, getStorageStats } from './mediaStore.js';
import { speakText, stopSpeech } from './tts.js';

// --- Global State Extension ---
state.tasks = []; // Active background processing tasks
state.notifications = []; // User notifications


// --- Initialization ---

/** Loads user settings and conversation history on startup. */
loadSettings((loadedState) => {
  if (loadedState.userApiKey) elements.apiKeyInput.value = loadedState.userApiKey;
  if (loadedState.ollamaUrl) elements.ollamaUrlInput.value = loadedState.ollamaUrl;
  if (loadedState.ollamaModel) elements.ollamaModelInput.value = loadedState.ollamaModel;
  if (loadedState.gcloudApiKey) elements.gcloudApiKeyInput.value = loadedState.gcloudApiKey;
  if (loadedState.gcloudRegion) elements.gcloudRegionInput.value = loadedState.gcloudRegion;
  if (loadedState.gcloudProjectId) elements.gcloudProjectIdInput.value = loadedState.gcloudProjectId;
  if (loadedState.ttsModel) elements.ttsModelSelect.value = loadedState.ttsModel;
  if (loadedState.userModel) elements.modelNameSelect.value = loadedState.userModel;
  if (loadedState.userTheme) {
    elements.themeSelect.value = loadedState.userTheme;
    if (loadedState.userThemeBgColor && elements.themeBgColorInput) {
      elements.themeBgColorInput.value = loadedState.userThemeBgColor;
    }
    applyTheme(loadedState.userTheme, loadedState.userThemeBgColor);
  }
  if (loadedState.userThemeColor) {
    elements.themeColorInput.value = loadedState.userThemeColor;
    applyThemeColor(loadedState.userThemeColor);
  }

  const isSoundEnabled = loadedState.soundEnabled !== undefined ? loadedState.soundEnabled : true;
  if (elements.soundEnabledInput) elements.soundEnabledInput.checked = isSoundEnabled;
  if (elements.soundTypeSelect) elements.soundTypeSelect.value = loadedState.soundType || 'chime';
  if (elements.soundTypeGroup) {
    elements.soundTypeGroup.style.opacity = isSoundEnabled ? '1' : '0.5';
    elements.soundTypeGroup.style.pointerEvents = isSoundEnabled ? 'auto' : 'none';
  }

  // Initialize Persistent Media Store
  initDB().catch(err => console.error("Failed to init MediaStore:", err));

  renderTabs();
  updateUsageHeader();
  setInlineQuestionCallback(handleInlineQuestionSubmit);
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

function showInputArea() {
  if (elements.inputWrapper) {
    elements.inputWrapper.classList.remove('hidden');
  }
  if (elements.chatLauncherBtn) {
    elements.chatLauncherBtn.classList.add('hidden');
  }
  if (elements.chatInput) {
    elements.chatInput.focus();
  }
}

function hideInputArea() {
  if (elements.inputWrapper) {
    elements.inputWrapper.classList.add('hidden');
  }
  if (elements.chatLauncherBtn) {
    elements.chatLauncherBtn.classList.remove('hidden');
  }
}

// --- Tab Helpers ---

function getActiveTab() {
  return state.tabs.find(t => t.id === state.activeTabId) || state.tabs[0];
}

function createTab() {
  const newTab = {
    id: Date.now().toString(),
    title: 'New Chat',
    history: [],
    contexts: [],
    usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 }
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

    const tabUsageK = tab.usage ? (tab.usage.totalTokens / 1000).toFixed(1) : '0.0';

    tabEl.innerHTML = `
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      ${tab.usage && tab.usage.totalTokens > 0 ? `<span class="tab-usage-badge">${tabUsageK}k</span>` : ''}
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
 * Resolves @-mentioned media links in the user message.
 * Fetches remote images, audio, video, PDFs, and webpage content to attach them to the request parts.
 */
async function resolveMentions(text) {
  const mentionRegex = /@(https?:\/\/[^\s"',;()]+)/g;
  const matches = [...text.matchAll(mentionRegex)];
  const mediaList = [];

  if (matches.length === 0) return mediaList;

  setExtractionLoading(true);
  showToast("Resolving media mentions...");

  for (const match of matches) {
    const url = match[1];
    
    // Check if YouTube URL
    const ytId = getYouTubeId(url);
    if (ytId) {
      mediaList.push({
        type: 'video/youtube',
        src: `https://www.youtube.com/watch?v=${ytId}`,
        youtubeId: ytId
      });
      continue;
    }

    // Direct Media / Document / Web link
    try {
      const response = await fetch(url);
      if (!response.ok) {
        showToast(`Could not fetch link: ${url}`);
        continue;
      }
      
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.startsWith('image/')) {
        const blob = await response.blob();
        const base64Data = await fileToBase64(blob);
        mediaList.push({
          type: contentType,
          src: url,
          base64: base64Data.split(',')[1],
          isImage: true
        });
      } else if (contentType.startsWith('audio/') || contentType.startsWith('video/')) {
        const blob = await response.blob();
        if (blob.size < 15 * 1024 * 1024) { // < 15MB inline limit
          const base64Data = await fileToBase64(blob);
          mediaList.push({
            type: contentType,
            src: url,
            base64: base64Data.split(',')[1],
            isInline: true
          });
        } else {
          // Large audio/video upload via Files API (Gemini only)
          const isOllama = state.userModel.startsWith('ollama');
          if (isOllama) {
            showToast("Warning: Local Ollama model does not support large file uploads.");
            continue;
          }
          
          showToast(`Uploading large media to Gemini: ${url.split('/').pop()}...`);
          const filename = url.split('/').pop() || 'media';
          const fileObj = new File([blob], filename, { type: contentType });
          const provider = getAIProvider(state.userModel);
          const uploadedFile = await provider.uploadFile(state.userApiKey, fileObj);
          
          let status = 'PROCESSING';
          while (status === 'PROCESSING') {
            await new Promise(r => setTimeout(r, 2000));
            const fileInfo = await provider.getFileStatus(state.userApiKey, uploadedFile.uri);
            status = fileInfo.state;
            if (status === 'FAILED') throw new Error("File API processing failed.");
          }
          
          mediaList.push({
            type: contentType,
            src: url,
            fileUri: uploadedFile.uri,
            isUploaded: true
          });
        }
      } else if (contentType.startsWith('application/pdf')) {
        const blob = await response.blob();
        const base64Data = await fileToBase64(blob);
        mediaList.push({
          type: contentType,
          src: url,
          base64: base64Data.split(',')[1],
          isPdf: true
        });
      } else if (contentType.includes('html') || contentType.includes('json') || contentType.startsWith('text/')) {
        const pageText = await response.text();
        let cleanText = pageText;
        if (contentType.includes('html')) {
          const doc = new DOMParser().parseFromString(pageText, 'text/html');
          const scripts = doc.querySelectorAll('script, style');
          scripts.forEach(s => s.remove());
          cleanText = doc.body.textContent || doc.body.innerText || '';
          cleanText = cleanText.replace(/\s+/g, ' ').trim(); // Normalize whitespace
        }
        mediaList.push({
          type: contentType,
          src: url,
          text: cleanText,
          isText: true
        });
      }
    } catch (err) {
      console.error("Failed to resolve mention:", url, err);
      showToast(`Failed to load: ${url.split('/').pop()}`);
    }
  }

  setExtractionLoading(false);
  return mediaList;
}

function getYouTubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=))([^"&?\/\s]{11})/);
  return (match && match[1]) ? match[1] : null;
}

/** 
 * Primary loop for sending a message. 
 * Orchestrates prompt building, UI updates, and AI streaming.
 */
function parseGitHubUrl(text) {
  const match = text.match(/@(https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+))/);
  if (!match) return null;
  const url = match[1];
  const owner = match[2];
  let repo = match[3];
  
  if (repo.includes('/')) {
    repo = repo.split('/')[0];
  }
  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }
  return { url, owner, repo };
}

/**
 * Streams the AI response from the selected LLM provider and updates history and token usage.
 */
async function streamAIResponse(promptParts, currentTab, systemInstruction, userQuery) {
  let streaming;
  try {
    const provider = getAIProvider(state.userModel);
    const aiIndex = currentTab.history.length;
    streaming = appendStreamingMessage(aiIndex);
    let accumulatedText = '';
    const uncompactedHistory = currentTab.history.filter(m => !m.compacted);

    let finalSystemInstruction = systemInstruction;
    if (currentTab.condensedSummary) {
      finalSystemInstruction += `\n\n[Summary of earlier conversation context]:\n${currentTab.condensedSummary}`;
    }

    const isOllama = state.userModel.startsWith('ollama');
    const providerKey = isOllama ? state.ollamaUrl : state.userApiKey;

    const stream = provider.streamGenerateContent(
      providerKey,
      state.userModel,
      uncompactedHistory.slice(0, -1),
      promptParts,
      finalSystemInstruction
    );

    let finalUsage = null;
    let accumulatedThought = '';
    for await (const chunk of stream) {
      if (chunk.thought) {
        accumulatedThought += chunk.thought;
        streaming.update(accumulatedText, accumulatedThought);
      }
      if (chunk.text) {
        accumulatedText += chunk.text;
        streaming.update(accumulatedText, accumulatedThought);
      }
      if (chunk.usage) {
        finalUsage = chunk.usage;
      }
    }

    // Process Usage Metadata (Global & Tab-Specific)
    if (finalUsage) {
      const pCount = (finalUsage.promptTokenCount || 0);
      const cCount = (finalUsage.candidatesTokenCount || 0);
      const tCount = (finalUsage.totalTokenCount || 0);

      // Global
      state.usage.promptTokens += pCount;
      state.usage.candidatesTokens += cCount;
      state.usage.totalTokens += tCount;

      // Tab Specific
      if (!currentTab.usage) {
        currentTab.usage = { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };
      }
      currentTab.usage.promptTokens += pCount;
      currentTab.usage.candidatesTokens += cCount;
      currentTab.usage.totalTokens += tCount;

      saveUsageToStorage();
      updateUsageHeader();
    }

    streaming.finalize(accumulatedText, finalUsage, accumulatedThought);
    currentTab.history.push({
      role: "model",
      parts: [{ text: accumulatedText }],
      thought: accumulatedThought,
      usage: finalUsage
    });
    saveTabsToStorage();

    // Trigger compaction background process
    compactHistory(currentTab.id);

    // Add query complete notification
    let notificationMsg = "Query complete";
    if (userQuery) {
      const cleanQuery = userQuery.replace(/\s+/g, ' ').trim();
      const truncatedQuery = cleanQuery.length > 40 ? cleanQuery.substring(0, 40) + "..." : cleanQuery;
      notificationMsg = `Query complete: "${truncatedQuery}"`;
    }
    addNotification(notificationMsg, "success");

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
    appendMessage('AI', `<div class="error-bubble"><b>Hold on a moment:</b> ${error.message}</div>`, undefined, null, null, null, null, `Hold on a moment: ${error.message}`);
  }
}

/** 
 * Primary loop for sending a message. 
 * Orchestrates prompt building, UI updates, and AI streaming.
 */
async function sendMessage(text) {
  if (!text.trim()) return;

  const currentTab = getActiveTab();

  // Check if it is a GitHub repository mention
  const githubInfo = parseGitHubUrl(text);
  if (githubInfo) {
    const { owner, repo } = githubInfo;
    const userIndex = currentTab.history.length;

    // 1. Append user's original message bubble
    appendMessage('user', marked.parse(text), userIndex, null, null, null, null, text);
    scrollToBottom();

    currentTab.history.push({ role: 'user', parts: [{ text: text }] });
    saveTabsToStorage();

    // Update tab title if it's the first message
    if (currentTab.history.length === 1) {
      currentTab.title = text.length > 20 ? text.substring(0, 20) + '...' : text;
      renderTabs();
    }

    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';
    hideInputArea();

    // 2. Append selector card placeholder
    const aiIndex = currentTab.history.length;
    const selector = appendGitHubSelectorMessage(aiIndex, owner, repo);

    // 3. Download and extract repository zipball asynchronously
    (async () => {
      try {
        selector.updateStatus("Downloading repository zipball...");
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball`);
        if (!response.ok) {
          throw new Error(`GitHub API returned status ${response.status}. Ensure the repository is public and exists.`);
        }

        selector.updateStatus("Extracting repository code files...");
        const blob = await response.blob();

        const zip = await JSZip.loadAsync(blob);
        const fileList = [];
        const promises = [];

        zip.forEach((relativePath, zipEntry) => {
          if (zipEntry.dir) return;

          const pathLower = relativePath.toLowerCase();
          // Filter out binary, build, locks and git folders
          if (
            pathLower.includes('/node_modules/') ||
            pathLower.includes('/.git/') ||
            pathLower.includes('/dist/') ||
            pathLower.includes('/build/') ||
            pathLower.includes('/package-lock.json') ||
            pathLower.includes('/yarn.lock') ||
            pathLower.includes('/pnpm-lock.yaml')
          ) {
            return;
          }

          const ext = relativePath.split('.').pop().toLowerCase();
          const allowedExtensions = [
            'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'md', 'py', 'java', 'c', 'cpp',
            'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'yml', 'yaml', 'toml', 'sql', 'xml'
          ];
          if (!allowedExtensions.includes(ext)) {
            return;
          }

          promises.push(
            zipEntry.async('text').then(content => {
              const parts = relativePath.split('/');
              parts.shift(); // Remove top level directory prefix
              const cleanPath = parts.join('/');
              
              fileList.push({ path: cleanPath, content });
            })
          );
        });

        await Promise.all(promises);

        fileList.sort((a, b) => a.path.localeCompare(b.path));

        if (fileList.length === 0) {
          throw new Error("No supported text/code files found in this repository.");
        }

        // 4. Populate checklist UI and handle analysis submission
        selector.populateFiles(fileList, async (selectedFiles) => {
          if (selectedFiles.length === 0) {
            showToast("No files selected. Codebase analysis cancelled.");
            selector.updateStatus("Analysis cancelled (no files selected).", true);
            return;
          }

          let repoContext = `GITHUB REPOSITORY CONTEXT (${owner}/${repo}):\n\n`;
          selectedFiles.forEach(file => {
            repoContext += `[File: ${file.path}]\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
          });

          const promptParts = buildPrompt(text, currentTab.contexts);
          promptParts.push({ text: repoContext });

          const systemInstruction = getSystemInstructions();
          await streamAIResponse(promptParts, currentTab, systemInstruction, text);
        });

      } catch (err) {
        console.error(err);
        selector.updateStatus(err.message, true);
        showToast(`GitHub Error: ${err.message}`);
      }
    })();

    return;
  }
  
  // 1. Resolve standard @mentions
  let mediaList = [];
  try {
    mediaList = await resolveMentions(text);
  } catch (err) {
    console.error("Mentions resolution failed:", err);
  }

  const promptParts = buildPrompt(text, currentTab.contexts);

  // 2. Append resolved mentions to promptParts
  mediaList.forEach(media => {
    if (media.type === 'video/youtube') {
      promptParts.push({
        file_data: {
          file_uri: media.src
        }
      });
    } else if (media.isInline || media.isImage || media.isPdf) {
      promptParts.push({
        inline_data: {
          mime_type: media.type,
          data: media.base64
        }
      });
    } else if (media.isUploaded) {
      promptParts.push({
        file_data: {
          mime_type: media.type,
          file_uri: media.fileUri
        }
      });
    } else if (media.isText) {
      promptParts.push({
        text: `\n\n[Content of linked page ${media.src}]:\n${media.text}\n`
      });
    }
  });

  const userIndex = currentTab.history.length;
  const contextSummary = currentTab.contexts.map(c => ({ tag: c.tag, name: c.name }));
  const videoData = mediaList.length > 0 ? mediaList : null;

  appendMessage('user', marked.parse(text), userIndex, videoData, null, contextSummary, null, text);
  scrollToBottom();

  const userTurn = {
    role: "user",
    parts: promptParts,
    contextSummary: contextSummary,
    videoData: videoData
  };
  const systemInstruction = getSystemInstructions();
  currentTab.history.push(userTurn);

  // Optimization removed per user request to maintain UX context persistence
  // currentTab.contexts = [];
  // renderContextChips();

  // Update tab title if it's the first message
  if (currentTab.history.length === 1) {
    currentTab.title = text.length > 20 ? text.substring(0, 20) + '...' : text;
    renderTabs();
  }

  saveTabsToStorage();

  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';
  hideInputArea();

  await streamAIResponse(promptParts, currentTab, systemInstruction, text);
}

/**
 * Automatically compacts conversation history to save tokens.
 * Triggers when history has more than 16 uncompacted messages.
 * Keeps the most recent 6 messages, condenses the rest into a single summary.
 */
async function compactHistory(tabId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || tab.isCompacting) return;

  const MAX_UNCOMPACTED = 16;
  const KEEP_RECENT = 6;

  const uncompactedStartIndex = tab.history.findIndex(m => !m.compacted);
  if (uncompactedStartIndex === -1) return;

  const uncompactedCount = tab.history.length - uncompactedStartIndex;
  if (uncompactedCount <= MAX_UNCOMPACTED) return;

  tab.isCompacting = true;

  try {
    const provider = getAIProvider(state.userModel);

    // Select messages to summarize
    const endIndex = tab.history.length - KEEP_RECENT;
    const messagesToSummarize = tab.history.slice(uncompactedStartIndex, endIndex);

    // Format them for the prompt
    let conversationText = "";
    if (tab.condensedSummary) {
      conversationText += `[Existing Summary of earlier conversation]:\n${tab.condensedSummary}\n\n`;
    }

    for (const msg of messagesToSummarize) {
      const role = msg.role === 'user' ? 'User' : 'AI';
      let content = msg.parts[0]?.text || '';
      if (role === 'User' && content.includes('User Question:')) {
        content = extractUserQuestion(content);
      }
      conversationText += `${role}: ${content}\n\n`;
    }

    const isOllama = state.userModel.startsWith('ollama');
    const providerKey = isOllama ? state.ollamaUrl : state.userApiKey;

    const summary = await provider.generateSummary(providerKey, state.userModel, conversationText);

    tab.condensedSummary = summary;

    // Mark as compacted
    for (const msg of messagesToSummarize) {
      msg.compacted = true;
    }

    saveTabsToStorage();
    showToast("Background history compaction completed.");

  } catch (error) {
    console.error("Compaction failed:", error);
  } finally {
    tab.isCompacting = false;
  }
}

/**
 * Handles inline sub-question submission from a block-level hover trigger.
 * Streams a brief answer in-place directly below the reference block.
 */
async function handleInlineQuestionSubmit(messageIndex, blockIndex, blockEl, question) {
  const currentTab = getActiveTab();
  
  const placeholderAnswer = `<div class="loader-spinner" style="margin-top: 4px;"></div> <span style="font-size: 0.8rem; color: var(--text-muted);">Generating answer...</span>`;
  const subConvBox = renderSubConversationBox(blockEl, messageIndex, blockIndex, question, placeholderAnswer, false);

  try {
    const provider = getAIProvider(state.userModel);
    
    // Construct context and strict brevity system instruction
    const paragraphText = blockEl.innerText.replace(/[\n\r]+/g, ' ').trim();
    const subSystemInstruction = `${getSystemInstructions()}\n\nCRITICAL: You are answering a specific follow-up question about a portion of your previous answer. You MUST be extremely brief and concise. Answer in exactly 1 or 2 sentences maximum. Do not exceed this length under any circumstances.`;

    const promptParts = [
      { text: `Regarding the previous statement: "${paragraphText}"\n\nFollow-up question: ${question}` }
    ];

    const historySlice = currentTab.history.slice(0, messageIndex);
    const uncompactedHistory = historySlice.filter(m => !m.compacted);

    const isOllama = state.userModel.startsWith('ollama');
    const providerKey = isOllama ? state.ollamaUrl : state.userApiKey;

    const stream = provider.streamGenerateContent(
      providerKey,
      state.userModel,
      uncompactedHistory,
      promptParts,
      subSystemInstruction
    );

    let answerText = '';
    const answerEl = subConvBox.querySelector('.sub-conv-answer');
    
    for await (const chunk of stream) {
      if (chunk.text) {
        answerText += chunk.text;
        answerEl.innerHTML = marked.parse(preprocessResponse(answerText));
        smartScroll();
      }
    }

    // Persist sub-conversation in the history object
    const msg = currentTab.history[messageIndex];
    if (msg) {
      if (!msg.subConversations) msg.subConversations = [];
      msg.subConversations = msg.subConversations.filter(s => s.blockIndex !== blockIndex);
      msg.subConversations.push({
        blockIndex,
        question,
        answer: marked.parse(preprocessResponse(answerText)),
        collapsed: false
      });
      saveTabsToStorage();
    }

    addNotification("Sub-discussion updated", "success");

  } catch (err) {
    console.error(err);
    const answerEl = subConvBox.querySelector('.sub-conv-answer');
    answerEl.innerHTML = `<span style="color: #ef4444; font-weight: 500;">⚠️ Error: ${err.message}</span>`;
    showToast(`Failed to answer: ${err.message}`);
  }
}

/** Updates the cumulative token usage display in the app header. */
function updateUsageHeader() {
  const headerUsage = document.getElementById('headerUsage');
  if (headerUsage) {
    const totalK = (state.usage.totalTokens / 1000).toFixed(1);
    const currentTab = getActiveTab();
    const tabTotalK = currentTab && currentTab.usage ? (currentTab.usage.totalTokens / 1000).toFixed(1) : '0.0';

    headerUsage.innerText = `${totalK}k Overall • ${tabTotalK}k Tab`;
    headerUsage.title = `OVERALL: ${state.usage.totalTokens} | TAB: ${currentTab && currentTab.usage ? currentTab.usage.totalTokens : 0}`;
  }
}

/** Re-renders the entire chat from the stored conversation history. */
function reconstructChatFromHistory() {
  if (!elements.chatHistory) return;
  elements.chatHistory.innerHTML = '';
  const currentTab = getActiveTab();
  if (currentTab.history.length === 0) {
    showWelcomeMessage();
    showInputArea();
    return;
  }

  hideInputArea();

  currentTab.history.forEach((msg, index) => {
    if (msg.type === 'task') {
      appendProgressMessage(msg.sender, msg.taskName, msg.videoData, msg.taskId, currentTab.id);
    } else {
      const isUser = msg.role === 'user';
      const content = isUser ? extractUserQuestion(msg.parts[0].text) : msg.parts[0].text;
      const htmlContent = isUser ? marked.parse(content) : marked.parse(preprocessResponse(content));
      appendMessage(isUser ? 'user' : 'AI', htmlContent, index, msg.videoData, msg.usage, msg.contextSummary, msg.thought, content);
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
    // Pause all playing videos and audios to release resources
    document.querySelectorAll('.feed-video, .feed-audio').forEach(media => {
      media.pause();
      if (media.src) URL.revokeObjectURL(media.src);
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
      const isAudio = isLocal ? (item.type && item.type.startsWith('audio/')) : (item.mimeType && item.mimeType.startsWith('audio/'));

      return `
        <div class="feed-card" data-id="${id}">
          <div class="feed-video-container">
            ${isLocal
          ? (isAudio
             ? `<div class="audio-card-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>
                  </svg>
                  <audio class="feed-audio" data-local-id="${id}"></audio>
                </div>`
             : `<video class="feed-video" loop muted data-local-id="${id}" poster="img/video-placeholder.png"></video>`)
          : (isAudio
             ? `<div class="audio-card-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>
                  </svg>
                  <p>Cloud Audio</p>
                </div>`
             : `
                <div class="video-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <p>Cloud Asset</p>
                </div>
              `)
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
      const media = card.querySelector('.feed-video') || card.querySelector('.feed-audio');
      if (!media) return;

      const ppBtn = card.querySelector('.play-pause-btn');
      const muteBtn = card.querySelector('.mute-btn');
      const seekerFill = card.querySelector('.seeker-fill');

      media.addEventListener('play', () => {
        ppBtn.querySelector('.play-icon').classList.add('hidden');
        ppBtn.querySelector('.pause-icon').classList.remove('hidden');
      });
      media.addEventListener('pause', () => {
        ppBtn.querySelector('.play-icon').classList.remove('hidden');
        ppBtn.querySelector('.pause-icon').classList.add('hidden');
      });
      media.addEventListener('volumechange', () => {
        if (media.muted) {
          muteBtn.querySelector('.volume-up-icon').classList.add('hidden');
          muteBtn.querySelector('.volume-mute-icon').classList.remove('hidden');
        } else {
          muteBtn.querySelector('.volume-up-icon').classList.remove('hidden');
          muteBtn.querySelector('.volume-mute-icon').classList.add('hidden');
        }
      });
      media.addEventListener('timeupdate', () => {
        const progress = (media.currentTime / media.duration) * 100;
        seekerFill.style.width = `${progress}%`;
      });

      card.addEventListener('mouseenter', () => media.play().catch(() => { }));
      card.addEventListener('mouseleave', () => {
        media.pause();
        media.currentTime = 0;
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
    const audios = document.querySelectorAll('.feed-audio[data-local-id]');
    for (const audio of audios) {
      const id = audio.getAttribute('data-local-id');
      const blob = await getMedia(id);
      if (blob) {
        if (!audio.src) audio.src = URL.createObjectURL(blob);
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
            this.close();
            if (blob.type.startsWith('audio/')) {
              const file = new File([blob], item.name || id, { type: blob.type });
              AudioAnalysisModal.show(file);
              const options = await AudioAnalysisModal.getOptions();
              if (options.action === 'analyze') {
                startAudioAnalysis(file, options.promptText);
              }
            } else {
              const file = new File([blob], `${item.name || id}.webm`, { type: blob.type });
              VideoAnalysisModal.show(file);
              const options = await VideoAnalysisModal.getOptions();
              if (options.action === 'analyze') {
                startVideoAnalysis(file, { resolution: options.resolution, fps: options.fps }, options.promptText);
              }
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
      const media = card.querySelector('.feed-video') || card.querySelector('.feed-audio');
      if (media) {
        if (media.paused) media.play().catch(() => {});
        else media.pause();
      }
    } else if (e.target.closest('.mute-btn')) {
      const media = card.querySelector('.feed-video') || card.querySelector('.feed-audio');
      if (media) media.muted = !media.muted;
    } else if (e.target.closest('.filter-btn')) {
      const btn = e.target.closest('.filter-btn');
      const filter = btn.getAttribute('data-filter');
      const video = card.querySelector('.feed-video');
      if (video) {
        video.classList.toggle(`video-filter-${filter}`);
        btn.classList.toggle('active');
      }
    } else if (e.target.closest('.download-btn')) {
      const media = card.querySelector('.feed-video') || card.querySelector('.feed-audio');
      if (media && media.src) {
        const a = document.createElement('a');
        a.href = media.src;
        const item = this.items.find(i => i.id === id);
        const isAudio = item && item.type && item.type.startsWith('audio/');
        a.download = `clip-${id}.${isAudio ? 'mp3' : 'webm'}`;
        a.click();
      }
    } else if (e.target.closest('.video-seeker')) {
      const seeker = e.target.closest('.video-seeker');
      const media = card.querySelector('.feed-video') || card.querySelector('.feed-audio');
      if (media && media.duration) {
        const rect = seeker.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        media.currentTime = pos * media.duration;
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

/**
 * What: Captures the visible area of the current tab as a screenshot.
 * Why: Quick way for users to provide visual context to the AI.
 */
async function captureCurrentTabScreenshot() {
  state.isClipping = !state.isClipping;
  updateClippingUI();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      sendMessageToTab(tabs[0].id, {
        type: state.isClipping ? "START_CLIP" : "STOP_SELECTION"
      });
    }
  });
}

function updateClippingUI() {
  elements.screenshotBtn.classList.toggle('active', state.isClipping);
  elements.inputWrapper.classList.toggle('extracting', state.isClipping);
}

// --- Event Listeners ---

elements.sendBtn.addEventListener('click', () => sendMessage(elements.chatInput.value));
elements.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(elements.chatInput.value);
  } else if (e.key === 'Escape') {
    hideInputArea();
  }
});

if (elements.chatLauncherBtn) {
  elements.chatLauncherBtn.addEventListener('click', showInputArea);
}
if (elements.closeInputBtn) {
  elements.closeInputBtn.addEventListener('click', hideInputArea);
}

elements.newTabBtn.addEventListener('click', createTab);
elements.extractBtn.addEventListener('click', toggleExtraction);
elements.extractPdfBtn.addEventListener('click', extractCurrentPagePdf);
elements.screenshotBtn.addEventListener('click', () => captureCurrentTabScreenshot());
elements.webcamBtn.addEventListener('click', () => WebcamModal.open());
elements.uploadBtn.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', handleFileSelect);

// Drag and Drop Event Listeners
let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1 && elements.dropZone) {
    elements.dropZone.classList.remove('hidden');
  }
});

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0 && elements.dropZone) {
    elements.dropZone.classList.add('hidden');
  }
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
});

// Transforms common cloud viewer URLs into direct download links
function transformCloudUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('dropbox.com')) {
      u.searchParams.set('dl', '1');
      return u.toString();
    }
    if (u.hostname.includes('drive.google.com')) {
      const match = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `https://drive.google.com/uc?export=download&id=${match[1]}`;
      }
    }
    if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) {
      u.hostname = 'raw.githubusercontent.com';
      u.pathname = u.pathname.replace('/blob/', '/');
      return u.toString();
    }
  } catch (e) {}
  return urlStr;
}

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  if (elements.dropZone) {
    elements.dropZone.classList.add('hidden');
  }
  
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const files = Array.from(e.dataTransfer.files);
    await handleFiles(files);
  } else {
    // Try to extract a URL from the dropped data
    const uriList = e.dataTransfer.getData('text/uri-list');
    const plainText = e.dataTransfer.getData('text/plain');
    
    let urlToFetch = null;
    if (uriList) {
      const uris = uriList.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
      if (uris.length > 0) urlToFetch = uris[0];
    }
    
    if (!urlToFetch && plainText && /^https?:\/\//i.test(plainText.trim())) {
      urlToFetch = plainText.trim();
    }
    
    if (urlToFetch) {
      try {
        setExtractionLoading(true);
        const finalUrl = transformCloudUrl(urlToFetch);
        const response = await fetch(finalUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);
        
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html') || 
            contentType.includes('application/javascript') || 
            contentType.includes('text/javascript') ||
            contentType.includes('text/css')) {
            showToast("Dropped link is a webpage or web asset, not a supported file.");
            return;
        }
        
        const blob = await response.blob();
        
        // Derive a filename from the URL
        let filename = 'downloaded_file';
        try {
            const urlObj = new URL(urlToFetch);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) {
                filename = pathParts[pathParts.length - 1];
            }
        } catch (err) {}
        
        // Add an extension if missing
        if (!filename.includes('.')) {
             const ext = blob.type.split('/')[1];
             if (ext && ext !== 'octet-stream') {
                 const cleanExt = ext.split(';')[0].trim();
                 filename += `.${cleanExt}`;
             }
        }
        
        const file = new File([blob], filename, { type: blob.type });
        await handleFiles([file]);
      } catch (error) {
        console.error("Failed to download dropped link:", error);
        showToast(`Failed to download link: ${error.message}`);
      } finally {
        setExtractionLoading(false);
      }
    }
  }
});

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

// Settings Save Logic removed (using main save listener at bottom of file)

/**
 * Processes a list of files (from file input or drag-and-drop).
 */
async function handleFiles(files) {
  if (files.length === 0) return;

  setExtractionLoading(true);
  try {
    for (const file of files) {
      try {
        if (file.type.startsWith('video/')) {
          setExtractionLoading(false);
          VideoAnalysisModal.show(file);
          const options = await VideoAnalysisModal.getOptions();

          if (options.action === 'analyze') {
            startVideoAnalysis(file, { resolution: options.resolution, fps: options.fps }, options.promptText);
          }
          continue;
        } else if (file.type.startsWith('audio/')) {
          setExtractionLoading(false);
          AudioAnalysisModal.show(file);
          const options = await AudioAnalysisModal.getOptions();

          if (options.action === 'analyze') {
            startAudioAnalysis(file, options.promptText);
          }
          continue;
        } else {
          await processFile(file);
        }
      } catch (err) {
        console.error("Error processing file:", err);
        showToast(`Error processing ${file.name}: ${err.message}`);
      }
    }
  } finally {
    setExtractionLoading(false);
  }
}

/**
 * Enhanced file selector to handle Video optimization and 
 * Background analysis triggers.
 */
async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  try {
    await handleFiles(files);
  } finally {
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
  appendMessage('user', displayPrompt, userIndex, { ...videoData }, null, null, null, displayPrompt);
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

/**
 * Core Orchestrator for Background Audio Analysis.
 */
async function startAudioAnalysis(file, userPrompt) {
  const taskId = Date.now().toString();
  const tabId = state.activeTabId;
  const currentTab = state.tabs.find(t => t.id === tabId);

  // 1. Create a progress message in the chat with an audio preview
  let audioData = null;
  if (file.src) {
    audioData = { src: file.src, type: file.type };
  } else {
    audioData = { src: URL.createObjectURL(file), type: file.type, file: file };
  }

  // 0. Show the user's prompt in the chat history
  const displayPrompt = userPrompt || "Analyze this audio.";
  const userIndex = currentTab.history.length;
  appendMessage('user', displayPrompt, userIndex, { ...audioData }, null, null, null, displayPrompt);
  currentTab.history.push({ role: 'user', parts: [{ text: displayPrompt }], videoData: { ...audioData } });

  const task = {
    id: taskId,
    tabId: tabId,
    name: `Analyzing ${file.name}`,
    status: 'starting',
    progress: 0
  };
  state.tasks.push(task);
  renderTabs(); // Show badge

  const progressUpdater = appendProgressMessage('AI', task.name, audioData, taskId, tabId);

  try {
    const provider = getAIProvider(state.userModel);
    
    // Path: Upload Original (File API)
    progressUpdater.update(10, 'Initializing secure upload...');
    const uploadedFile = await provider.uploadFile(state.userApiKey, file, (p) => {
      const uploadProgress = 10 + (p * 0.7); // 10% to 80%
      progressUpdater.update(Math.round(uploadProgress), `Uploading... ${p}%`);
    });

    progressUpdater.update(85, 'AI is processing audio content...');
    let status = 'PROCESSING';
    while (status === 'PROCESSING') {
      await new Promise(r => setTimeout(r, 4000));
      const fileInfo = await provider.getFileStatus(state.userApiKey, uploadedFile.uri);
      status = fileInfo.state;
      if (status === 'FAILED') throw new Error("Gemini File API processing failed.");
    }

    const promptParts = [
      { file_data: { mime_type: uploadedFile.mimeType, file_uri: uploadedFile.uri } },
      { text: userPrompt }
    ];

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
function playNotificationSound(typeOverride) {
  const enabled = typeOverride !== undefined ? true : (state.soundEnabled !== undefined ? state.soundEnabled : true);
  if (!enabled) return;

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const soundType = typeOverride || state.soundType || 'chime';

    if (soundType === 'beep') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.15);
    } else if (soundType === 'two-tone') {
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain1.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc1.start(audioCtx.currentTime);
      osc1.stop(audioCtx.currentTime + 0.08);

      setTimeout(() => {
        try {
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(1046.5, audioCtx.currentTime);
          gain2.gain.setValueAtTime(0.04, audioCtx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
          osc2.start(audioCtx.currentTime);
          osc2.stop(audioCtx.currentTime + 0.1);
        } catch (e) {}
      }, 80);
    } else if (soundType === 'bounce') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.15);
    } else {
      // default: chime
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime);
      gain1.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
      osc1.start(audioCtx.currentTime);
      osc1.stop(audioCtx.currentTime + 0.12);
      
      setTimeout(() => {
        try {
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime);
          gain2.gain.setValueAtTime(0.04, audioCtx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
          osc2.start(audioCtx.currentTime);
          osc2.stop(audioCtx.currentTime + 0.18);
        } catch (e) {}
      }, 80);
    }
  } catch (err) {
    console.error("Failed to play notification sound:", err);
  }
}

function addNotification(message, type) {
  const notification = { id: Date.now(), message, type, read: false, time: new Date() };
  state.notifications.unshift(notification);
  renderNotifications();
  showToast(message);
  playNotificationSound();
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

  if (file.type.startsWith('image/') || file.name.match(/\.(png|jpe?g|gif|webp)$/i)) {
    const base64Data = await fileToBase64(file);
    const processed = await resizeImage(base64Data);
    data.base64Images = [{
      base64: processed.base64,
      mimeType: processed.mimeType || 'image/jpeg',
      alt: file.name
    }];
  } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const base64Data = await fileToBase64(file);
    data.base64File = {
      base64: base64Data.split(',')[1],
      mimeType: 'application/pdf'
    };
  } else if (file.type.startsWith('text/') || file.name.match(/\.(md|js|css|html|csv|txt|json)$/i)) {
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
  state.isClipping = false;
  elements.extractBtn.classList.remove('active');
  elements.screenshotBtn.classList.remove('active');
  elements.inputWrapper.classList.remove('extracting');
}

// Relay messages from content script
chrome.runtime.onMessage.addListener((request) => {
  switch (request.type) {
    case 'ELEMENT_SELECTED':
      addContext(request.data);
      break;
    case 'CLIP_SELECTED':
      handleClipSelection(request.data);
      break;
    case 'SELECTION_CANCELLED':
      resetSelectionState();
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
  const viewCanvasBtn = e.target.closest('.view-canvas-btn');
  const downloadImageBtn = e.target.closest('.download-image-btn');

  if (viewCanvasBtn) {
    const title = viewCanvasBtn.getAttribute('data-title');
    const base64 = viewCanvasBtn.getAttribute('data-image');
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            background: #0f111a;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            color: #fff;
            font-family: 'Inter', sans-serif;
          }
          .image-wrapper {
            max-width: 90%;
            max-height: 80vh;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            justify-content: center;
            align-items: center;
            background: #000;
          }
          img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
          }
          p {
            margin-top: 24px;
            font-size: 14px;
            opacity: 0.7;
            text-align: center;
            max-width: 600px;
            line-height: 1.5;
            padding: 0 20px;
          }
        </style>
      </head>
      <body>
        <div class="image-wrapper">
          <img src="data:image/jpeg;base64,${base64}" alt="${escapeHtml(title)}" />
        </div>
        <p>${escapeHtml(title)}</p>
      </body>
      </html>
    `;
    openCanvas(title, html);
    return;
  }

  if (downloadImageBtn) {
    const base64 = downloadImageBtn.getAttribute('data-image');
    const filename = downloadImageBtn.getAttribute('data-filename') || 'image.jpg';
    const a = document.createElement('a');
    a.href = `data:image/jpeg;base64,${base64}`;
    a.download = filename;
    a.click();
    return;
  }

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

  const contextTag = e.target.closest('.message-context-tag');
  if (contextTag) {
    const details = contextTag.querySelector('.message-context-details');
    details.classList.toggle('hidden');
    contextTag.classList.toggle('open');
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
    const text = msgContainer.markdownText || msgContainer.querySelector('.message-text').innerText;
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!');
      btn.classList.add('copied');
      btn.setAttribute('data-tooltip', 'Copied!');
      const originalSvg = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.setAttribute('data-tooltip', 'Copy message');
        btn.innerHTML = originalSvg;
      }, 2000);
    });
  }

  if (btn.classList.contains('copy-code-btn')) {
    const code = btn.getAttribute('data-code');
    navigator.clipboard.writeText(code).then(() => {
      showToast('Code copied!');
      const originalText = btn.innerText;
      btn.innerText = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerText = originalText;
        btn.classList.remove('copied');
      }, 2000);
    });
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
      msgContainer.classList.add('editing');
      editArea.innerHTML = `
        <textarea class="edit-textarea">${question}</textarea>
        <div class="edit-buttons">
          <button class="save-edit-btn">Save & Retry</button>
          <button class="cancel-edit-btn">Cancel</button>
        </div>
      `;

      const textarea = editArea.querySelector('.edit-textarea');
      if (textarea) {
        // Function to adjust height with max limit
        const adjustHeight = () => {
          textarea.style.height = 'auto';
          // Add 6px offset to account for borders and padding breathing room
          const newHeight = Math.min(textarea.scrollHeight + 6, 200);
          textarea.style.height = newHeight + 'px';
          textarea.style.overflowY = textarea.scrollHeight > 200 ? 'auto' : 'hidden';
        };

        // Auto-resize initially - defer slightly to allow the browser to complete layout reflow
        setTimeout(adjustHeight, 20);

        // Auto-resize on input
        textarea.addEventListener('input', adjustHeight);

        // Focus and place cursor at end
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }
  }

  if (btn.classList.contains('save-edit-btn')) {
    const idx = parseInt(index);
    const newText = msgContainer.querySelector('.edit-textarea').value;
    if (newText.trim()) {
      const currentTab = getActiveTab();
      currentTab.history = currentTab.history.slice(0, idx);

      // Reset compaction state on branch edit
      currentTab.condensedSummary = "";
      currentTab.history.forEach(m => m.compacted = false);

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

        // Reset compaction state on retry branch
        currentTab.condensedSummary = "";
        currentTab.history.forEach(m => m.compacted = false);

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
    content = marked.parse(preprocessResponse(content));
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
  applyTheme(state.userTheme, state.userThemeBgColor);
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
  if (elements.themeBgColorInput) {
    elements.themeBgColorInput.value = state.userThemeBgColor;
  }
  if (elements.soundEnabledInput) elements.soundEnabledInput.checked = state.soundEnabled !== undefined ? state.soundEnabled : true;
  if (elements.soundTypeSelect) elements.soundTypeSelect.value = state.soundType || 'chime';
  if (elements.soundTypeGroup) {
    elements.soundTypeGroup.style.opacity = (state.soundEnabled !== undefined ? state.soundEnabled : true) ? '1' : '0.5';
    elements.soundTypeGroup.style.pointerEvents = (state.soundEnabled !== undefined ? state.soundEnabled : true) ? 'auto' : 'none';
  }
  elements.settingsOverlay.classList.remove('hidden');
});

elements.closeSettingsBtn.addEventListener('click', closeAndRevertSettings);

// Add real-time preview listeners
elements.themeSelect.addEventListener('change', (e) => applyTheme(e.target.value, elements.themeBgColorInput.value));
elements.themeBgColorInput.addEventListener('input', (e) => applyTheme(elements.themeSelect.value, e.target.value));
elements.themeColorInput.addEventListener('input', (e) => applyThemeColor(e.target.value));

if (elements.soundEnabledInput) {
  elements.soundEnabledInput.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    if (elements.soundTypeGroup) {
      elements.soundTypeGroup.style.opacity = isEnabled ? '1' : '0.5';
      elements.soundTypeGroup.style.pointerEvents = isEnabled ? 'auto' : 'none';
    }
  });
}

if (elements.soundTypeSelect) {
  elements.soundTypeSelect.addEventListener('change', (e) => {
    playNotificationSound(e.target.value);
  });
}

elements.saveSettingsBtn.addEventListener('click', () => {
  saveSettings(
    elements.apiKeyInput.value,
    elements.modelNameSelect.value,
    elements.themeSelect.value,
    elements.themeColorInput.value,
    elements.themeBgColorInput.value,
    elements.gcloudApiKeyInput.value,
    elements.gcloudRegionInput.value,
    elements.gcloudProjectIdInput.value,
    elements.ttsModelSelect.value,
    elements.ollamaUrlInput.value,
    elements.ollamaModelInput.value,
    elements.soundEnabledInput.checked,
    elements.soundTypeSelect.value
  );
  applyTheme(state.userTheme, state.userThemeBgColor);
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
    showInputArea();
  }
});

// Auto-resize input textarea based on content
elements.chatInput.addEventListener('input', () => {
  elements.chatInput.style.height = 'auto';
  elements.chatInput.style.height = (elements.chatInput.scrollHeight) + 'px';
});

/** 
 * Handles the completion of a clip selection. 
 * Captures the tab, crops the image, and adds to context.
 */
async function handleClipSelection(rect) {
  chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 }, async (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      showToast("Failed to capture tab for clipping.");
      resetSelectionState();
      return;
    }

    try {
      const croppedDataUrl = await cropImage(dataUrl, rect);
      const processed = await resizeImage(croppedDataUrl);
      
      addContext({
        tag: 'SCREENSHOT_CLIP',
        name: `Clip ${new Date().toLocaleTimeString()}`,
        base64Images: [{
          base64: processed.base64,
          mimeType: processed.mimeType,
          alt: 'Clipped Region'
        }]
      });
      showToast("Region clipped and added!");
    } catch (err) {
      console.error("Clipping error:", err);
      showToast("Error processing clip.");
    } finally {
      resetSelectionState();
    }
  });
}

async function cropImage(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const dpr = rect.dpr || 1;
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        ctx.drawImage(
          img,
          rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr,
          0, 0, rect.width * dpr, rect.height * dpr
        );
        
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("Failed to load image for cropping"));
    img.src = dataUrl;
  });
}

