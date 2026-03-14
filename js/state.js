/**
 * state.js
 * Manages global application state and persistence 
 * using chrome.storage.local.
 */

export const state = {
  selectedContexts: [],   // Array of extracted element data
  isExtracting: false,     // Toggles select-to-extract mode
  userApiKey: '',
  userModel: 'gemini-2.0-flash',
  userTheme: 'light',
  conversationHistory: [] // Stored Gemini-format messages
};

/** Syncs current conversation history to local storage. */
export function saveHistoryToStorage() {
  chrome.storage.local.set({ chatHistoryData: state.conversationHistory });
}

/** Loads all settings and history from local storage. */
export function loadSettings(callback) {
  chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'userTheme', 'chatHistoryData'], (result) => {
    if (result.geminiApiKey) state.userApiKey = result.geminiApiKey;
    if (result.geminiModel) state.userModel = result.geminiModel;
    if (result.userTheme) state.userTheme = result.userTheme;
    if (result.chatHistoryData) state.conversationHistory = result.chatHistoryData;
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
