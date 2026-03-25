/**
 * ui.js
 * Centralizes DOM element references and provides
 * reusable UI utility functions (scrolling, toast, etc.).
 */

export const elements = {
  chatHistory: document.getElementById('chatHistory'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  extractBtn: document.getElementById('extractBtn'),
  extractPdfBtn: document.getElementById('extractPdfBtn'),
  webcamBtn: document.getElementById('webcamBtn'),
  contextContainer: document.getElementById('contextContainer'),
  extractionLoader: document.getElementById('extraction-loader'),
  inputWrapper: document.querySelector('.input-area-wrapper'),
  settingsBtn: document.getElementById('settingsBtn'),
  clearBtn: document.getElementById('clearBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  apiKeyInput: document.getElementById('apiKey'),
  gcloudApiKeyInput: document.getElementById('gcloudApiKey'),
  gcloudRegionInput: document.getElementById('gcloudRegion'),
  gcloudProjectIdInput: document.getElementById('gcloudProjectId'),
  ttsModelSelect: document.getElementById('ttsModel'),
  modelNameSelect: document.getElementById('modelName'),
  themeSelect: document.getElementById('themeSelect'),
  themeColorInput: document.getElementById('themeColor'),
  hljsStyle: document.getElementById('hljsStyle'),
  tabsList: document.getElementById('tabsList'),
  newTabBtn: document.getElementById('newTabBtn'),
  fileInput: document.getElementById('fileInput'),
  uploadBtn: document.getElementById('uploadBtn'),
  canvasContainer: document.getElementById('canvasContainer'),
  canvasFrame: document.getElementById('canvasFrame'),
  closeCanvasBtn: document.getElementById('closeCanvasBtn'),
  canvasTitle: document.getElementById('canvasTitle'),
  downloadBtn: document.getElementById('downloadBtn'),
  exportMenu: document.getElementById('exportMenu'),
  exportPdfBtn: document.getElementById('exportPdfBtn'),
  exportDocBtn: document.getElementById('exportDocBtn'),
  exportPngBtn: document.getElementById('exportPngBtn'),
  exportHtmlBtn: document.getElementById('exportHtmlBtn'),
  // Notifications & Webcam
  notificationBtn: document.getElementById('notificationBtn'),
  notificationBadge: document.getElementById('notificationBadge'),
  notificationPopover: document.getElementById('notificationPopover'),
  notificationList: document.getElementById('notificationList'),
  clearNotificationsBtn: document.getElementById('clearNotificationsBtn'),
  // Webcam elements
  webcamModal: document.getElementById('webcamModal'),
  webcamPreview: document.getElementById('webcamPreview'),
  mirrorWebcamBtn: document.getElementById('mirrorWebcamBtn'),
  closeWebcamBtn: document.getElementById('closeWebcamBtn'),
  startRecordingBtn: document.getElementById('startRecordingBtn'),
  captureFrameBtn: document.getElementById('captureFrameBtn'),
  recordStatus: document.getElementById('recordStatus'),
  webcamTimer: document.getElementById('webcamTimer'),
  // Video Analysis elements
  videoAnalysisModal: document.getElementById('videoAnalysisModal'),
  analysisVideoPreview: document.getElementById('analysisVideoPreview'),
  analysisResolution: document.getElementById('analysisResolution'),
  analysisFPS: document.getElementById('analysisFPS'),
  analysisPrompt: document.getElementById('analysisPrompt'),
  confirmAnalysisBtn: document.getElementById('confirmAnalysisBtn'),
  cancelAnalysisBtn: document.getElementById('cancelAnalysisBtn'),
  closeAnalysisModalBtn: document.getElementById('closeAnalysisModalBtn'),
  resolutionSelector: document.getElementById('resolutionSelector'),
  fpsSelector: document.getElementById('fpsSelector'),
  analysisPlayPauseBtn: document.getElementById('analysisPlayPauseBtn'),
  analysisMuteBtn: document.getElementById('analysisMuteBtn'),
  analysisSeekerFill: document.querySelector('#videoAnalysisModal .seeker-fill'),
  // Media Library Modal
  mediaLibraryModal: document.getElementById('mediaLibraryModal'),
  mediaGrid: document.getElementById('mediaGrid'),
  librarySearch: document.getElementById('librarySearch'),
  libraryStats: document.getElementById('libraryStats'),
  openLibraryBtn: document.getElementById('openLibraryBtn'),
  closeLibraryBtn: document.getElementById('closeLibraryBtn'),
  clearLibraryBtn: document.getElementById('clearLibraryBtn')
};

/** Switches between light and dark themes. */
export function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
    elements.hljsStyle.href = 'lib/highlight-dark.min.css';
  } else {
    document.body.classList.remove('dark-theme');
    elements.hljsStyle.href = 'lib/highlight-light.min.css';
  }
}

/** Applies a dynamic theme color across UI css variables. */
export function applyThemeColor(colorHex) {
  const root = document.documentElement;
  root.style.setProperty('--accent-primary', colorHex);
  root.style.setProperty('--accent-secondary', colorHex);
  root.style.setProperty('--accent-accent', colorHex);
  root.style.setProperty('--gradient-main', `linear-gradient(135deg, ${colorHex}, ${colorHex}dd)`);
}

/** Instant scroll to the bottom of the chat history. */
export function scrollToBottom() {
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
}

/** 
 * Scroll to bottom only if user is already near the bottom. 
 * Prevents jumping while reading old messages.
 */
export function smartScroll() {
  const threshold = 100; // px
  const isAtBottom = elements.chatHistory.scrollHeight - elements.chatHistory.scrollTop <= elements.chatHistory.clientHeight + threshold;
  if (isAtBottom) {
    scrollToBottom();
  }
}

/** Shows a brief popup notification at the bottom of the screen. */
export function showToast(message) {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function escapeHtml(unsafe) {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
