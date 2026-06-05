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
  screenshotBtn: document.getElementById('screenshotBtn'),
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
  ollamaUrlInput: document.getElementById('ollamaUrl'),
  ollamaModelInput: document.getElementById('ollamaModel'),
  gcloudApiKeyInput: document.getElementById('gcloudApiKey'),
  gcloudRegionInput: document.getElementById('gcloudRegion'),
  gcloudProjectIdInput: document.getElementById('gcloudProjectId'),
  ttsModelSelect: document.getElementById('ttsModel'),
  modelNameSelect: document.getElementById('modelName'),
  themeSelect: document.getElementById('themeSelect'),
  themeColorInput: document.getElementById('themeColor'),
  themeBgColorInput: document.getElementById('themeBgColor'),
  customBgGroup: document.getElementById('customBgGroup'),
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
  // Audio Analysis elements
  audioAnalysisModal: document.getElementById('audioAnalysisModal'),
  analysisAudioPreview: document.getElementById('analysisAudioPreview'),
  audioFilename: document.getElementById('audioFilename'),
  audioFilesize: document.getElementById('audioFilesize'),
  audioAnalysisPrompt: document.getElementById('audioAnalysisPrompt'),
  confirmAudioAnalysisBtn: document.getElementById('confirmAudioAnalysisBtn'),
  cancelAudioAnalysisBtn: document.getElementById('cancelAudioAnalysisBtn'),
  closeAudioAnalysisModalBtn: document.getElementById('closeAudioAnalysisModalBtn'),
  // Media Library Modal
  mediaLibraryModal: document.getElementById('mediaLibraryModal'),
  mediaGrid: document.getElementById('mediaGrid'),
  librarySearch: document.getElementById('librarySearch'),
  libraryStats: document.getElementById('libraryStats'),
  openLibraryBtn: document.getElementById('openLibraryBtn'),
  closeLibraryBtn: document.getElementById('closeLibraryBtn'),
  clearLibraryBtn: document.getElementById('clearLibraryBtn')
};

function getBrightness(hexColor) {
  const rgb = parseInt(hexColor.replace('#', ''), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 0) & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace("#",""), 16),
  amt = Math.round(2.55 * (percent * 100)),
  R = (num >> 16) + amt,
  G = (num >> 8 & 0x00FF) + amt,
  B = (num & 0x0000FF) + amt;
  return "#" + (0x1000000 + (R<255?R<0?0:R:255)*0x10000 + (G<255?G<0?0:G:255)*0x100 + (B<255?B<0?0:B:255)).toString(16).slice(1);
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.replace("#",""), 16),
  amt = Math.round(2.55 * (percent * 100)),
  R = (num >> 16) - amt,
  G = (num >> 8 & 0x00FF) - amt,
  B = (num & 0x0000FF) - amt;
  return "#" + (0x1000000 + (R<255?R<0?0:R:255)*0x10000 + (G<255?G<0?0:G:255)*0x100 + (B<255?B<0?0:B:255)).toString(16).slice(1);
}

/** Switches between light, dark, preset, and custom background themes. */
export function applyTheme(theme, customBgColor) {
  // Remove all previous theme classes from body
  const themeClasses = [
    'dark-theme', 'light-theme', 'nord-theme', 
    'solarized-dark-theme', 'solarized-light-theme', 
    'oled-theme', 'sepia-theme', 'custom-theme'
  ];
  themeClasses.forEach(cls => document.body.classList.remove(cls));

  if (elements.customBgGroup) {
    elements.customBgGroup.style.display = theme === 'custom' ? 'block' : 'none';
  }

  let isDark = false;

  if (theme === 'custom' && customBgColor) {
    document.body.classList.add('custom-theme');
    const brightness = getBrightness(customBgColor);
    isDark = brightness < 128;

    const body = document.body;
    body.style.setProperty('--bg-color', customBgColor);

    if (isDark) {
      body.style.setProperty('--surface-color', lightenColor(customBgColor, 0.05));
      body.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.15)');
      body.style.setProperty('--text-main', '#cbd5e1');
      body.style.setProperty('--text-muted', '#94a3b8');
      body.style.setProperty('--glass-bg', darkenColor(customBgColor, 0.05) + 'dd');
      body.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.15)');
      body.style.setProperty('--code-bg', darkenColor(customBgColor, 0.05));
      body.style.setProperty('--code-header', darkenColor(customBgColor, 0.02));
      body.style.setProperty('--code-border', 'rgba(255, 255, 255, 0.15)');
    } else {
      body.style.setProperty('--surface-color', '#ffffff');
      body.style.setProperty('--border-color', 'rgba(0, 0, 0, 0.08)');
      body.style.setProperty('--text-main', '#111827');
      body.style.setProperty('--text-muted', '#57606a');
      body.style.setProperty('--glass-bg', lightenColor(customBgColor, 0.05) + 'dd');
      body.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.08)');
      body.style.setProperty('--code-bg', darkenColor(customBgColor, 0.02));
      body.style.setProperty('--code-header', darkenColor(customBgColor, 0.05));
      body.style.setProperty('--code-border', 'rgba(0, 0, 0, 0.08)');
    }
  } else {
    // Reset any custom styles
    const body = document.body;
    body.style.removeProperty('--bg-color');
    body.style.removeProperty('--surface-color');
    body.style.removeProperty('--border-color');
    body.style.removeProperty('--text-main');
    body.style.removeProperty('--text-muted');
    body.style.removeProperty('--glass-bg');
    body.style.removeProperty('--glass-border');
    body.style.removeProperty('--code-bg');
    body.style.removeProperty('--code-header');
    body.style.removeProperty('--code-border');

    isDark = ['dark', 'nord', 'solarized-dark', 'oled'].includes(theme);
    document.body.classList.add(`${theme}-theme`);
  }

  if (isDark) {
    document.body.classList.add('dark-theme');
    elements.hljsStyle.href = 'lib/highlight-dark.min.css';
  } else {
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

  const body = document.body;
  body.style.setProperty('--accent-primary', colorHex);
  body.style.setProperty('--accent-secondary', colorHex);
  body.style.setProperty('--accent-accent', colorHex);
  body.style.setProperty('--gradient-main', `linear-gradient(135deg, ${colorHex}, ${colorHex}dd)`);
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
