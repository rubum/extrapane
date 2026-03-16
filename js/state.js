/**
 * state.js
 * Manages global application state and persistence 
 * using chrome.storage.local.
 */

export const state = {
  tabs: [],               // Array of { id, title, history, contexts }
  activeTabId: null,      // Currently selected tab ID
  isExtracting: false,     // Toggles select-to-extract mode
  userApiKey: '',
  userModel: 'gemini-2.0-flash',
  userTheme: 'light'
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
  chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'userTheme', 'chatTabsData', 'activeTabId'], (result) => {
    if (result.geminiApiKey) state.userApiKey = result.geminiApiKey;
    if (result.geminiModel) state.userModel = result.geminiModel;
    if (result.userTheme) state.userTheme = result.userTheme;
    
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
export function saveSettings(apiKey, model, theme) {
  state.userApiKey = apiKey;
  state.userModel = model;
  state.userTheme = theme;
  chrome.storage.local.set({
    geminiApiKey: apiKey,
    geminiModel: model,
    userTheme: theme
  });
}

/** Legacy support or helper to save history (now just saves all tabs) */
export function saveHistoryToStorage() {
  saveTabsToStorage();
}
