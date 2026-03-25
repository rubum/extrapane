/**
 * state.js
 * Manages global application state and persistence 
 * using chrome.storage.local.
 */

export const state = {
  tabs: [],               // Array of { id, title, history, contexts }
  activeTabId: null,      // Currently selected tab ID
  isExtracting: false,     // Toggles select-to-extract mode (DOM)
  userApiKey: '',
  gcloudApiKey: '',
  gcloudRegion: 'global',
  gcloudProjectId: '',
  ttsModel: 'gemini-2.5-flash-tts',
  userModel: 'gemini-3-flash-preview',
  userTheme: 'light',
  userThemeColor: '#2563eb',
  tasks: [],
  notifications: [],
  usage: {
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0
  }
};

/** Syncs all tabs and context to local storage. */
export function saveTabsToStorage() {
  chrome.storage.local.set({
    chatTabsData: state.tabs,
    activeTabId: state.activeTabId
  });
}

/** Loads all settings and history from local storage. */
export function loadSettings(callback) {
  chrome.storage.local.get(['geminiApiKey', 'gcloudApiKey', 'gcloudRegion', 'gcloudProjectId', 'ttsModel', 'geminiModel', 'userTheme', 'userThemeColor', 'chatTabsData', 'activeTabId'], (result) => {
    state.userApiKey = result.geminiApiKey || '';
    state.gcloudApiKey = result.gcloudApiKey || '';
    state.gcloudRegion = result.gcloudRegion || 'global';
    state.gcloudProjectId = result.gcloudProjectId || '';
    state.ttsModel = result.ttsModel || 'gemini-2.5-flash-tts';
    state.userModel = result.geminiModel || 'gemini-3-flash-preview';
    state.userTheme = result.userTheme || 'light';
    state.userThemeColor = result.userThemeColor || '#2563eb';
    if (result.persistentUsage) state.usage = result.persistentUsage;

    console.log("Settings loaded:", {
      userApiKey: !!state.userApiKey,
      gcloudApiKey: !!state.gcloudApiKey,
      gcloudRegion: state.gcloudRegion
    });

    if (result.chatTabsData && result.chatTabsData.length > 0) {
      state.tabs = result.chatTabsData;
      state.activeTabId = result.activeTabId || state.tabs[0].id;
    } else {
      // Initialize with a default tab if none exist
      const defaultTab = {
        id: Date.now().toString(),
        title: 'New Chat',
        history: [],
        contexts: []
      };
      state.tabs = [defaultTab];
      state.activeTabId = defaultTab.id;
    }

    if (callback) callback(state);
  });
}

/** Updates local state and persists settings to local storage. */
export function saveSettings(apiKey, model, theme, themeColor, gcloudApiKey, gcloudRegion, gcloudProjectId, ttsModel) {
  console.log("Saving settings with GCloud Key length:", (gcloudApiKey || "").length);
  state.userApiKey = apiKey || '';
  state.gcloudApiKey = gcloudApiKey || '';
  state.gcloudRegion = gcloudRegion || 'global';
  state.gcloudProjectId = gcloudProjectId || '';
  state.ttsModel = ttsModel || 'gemini-2.5-flash-tts';
  state.userModel = model || 'gemini-3-flash-preview';
  state.userTheme = theme || 'light';
  if (themeColor) state.userThemeColor = themeColor;

  chrome.storage.local.set({
    geminiApiKey: apiKey,
    gcloudApiKey: gcloudApiKey,
    gcloudRegion: state.gcloudRegion,
    gcloudProjectId: state.gcloudProjectId,
    ttsModel: state.ttsModel,
    geminiModel: model,
    userTheme: theme,
    userThemeColor: state.userThemeColor
  });
}

export function saveUsageToStorage() {
  chrome.storage.local.set({ persistentUsage: state.usage });
}

/** Legacy support or helper to save history (now just saves all tabs) */
export function saveHistoryToStorage() {
  saveTabsToStorage();
}
