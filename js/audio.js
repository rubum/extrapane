/**
 * audio.js
 * Handles the audio analysis modal UI controller.
 */

import { elements } from './ui.js';

export const AudioAnalysisModal = {
  currentFile: null,

  show(file) {
    this.currentFile = file;
    elements.audioAnalysisModal.classList.remove('hidden');
    elements.analysisAudioPreview.src = URL.createObjectURL(file);
    elements.audioFilename.innerText = file.name;
    elements.audioFilesize.innerText = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
    elements.audioAnalysisPrompt.focus();
    this.init();
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;
  },

  hide() {
    this.currentFile = null;
    elements.audioAnalysisModal.classList.add('hidden');
    if (elements.analysisAudioPreview.src) {
      URL.revokeObjectURL(elements.analysisAudioPreview.src);
      elements.analysisAudioPreview.src = '';
    }
    elements.audioAnalysisPrompt.value = '';
  },

  async getOptions() {
    return new Promise((resolve) => {
      const onConfirm = () => {
        const promptText = elements.audioAnalysisPrompt.value.trim() || "Analyze this audio.";
        cleanup();
        resolve({ action: 'analyze', promptText });
      };

      const onCancel = () => {
        cleanup();
        resolve({ action: 'cancel' });
      };

      const cleanup = () => {
        elements.confirmAudioAnalysisBtn.removeEventListener('click', onConfirm);
        elements.cancelAudioAnalysisBtn.removeEventListener('click', onCancel);
        elements.closeAudioAnalysisModalBtn.removeEventListener('click', onCancel);
        this.hide();
      };

      elements.confirmAudioAnalysisBtn.addEventListener('click', onConfirm);
      elements.cancelAudioAnalysisBtn.addEventListener('click', onCancel);
      elements.closeAudioAnalysisModalBtn.addEventListener('click', onCancel);
    });
  }
};
