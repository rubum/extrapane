/**
 * video.js
 * Handles video processing, frame extraction, and 
 * optimization UI logic.
 */

import { elements } from './ui.js';

export const VideoProcessor = {
  /**
   * Extracts frames from a video file at a specific FPS and resolution.
   * Useful for "optimizing" large videos for AI analysis.
   */
  async extractFrames(file, targetFps = 1, targetWidth = 480) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = URL.createObjectURL(file);
      video.muted = true;

      video.onloadedmetadata = async () => {
        const duration = video.duration;
        const width = video.videoWidth;
        const height = video.videoHeight;
        const aspectRatio = height / width;
        const targetHeight = Math.round(targetWidth * aspectRatio);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        const frames = [];
        const interval = 1 / targetFps;
        let currentTime = 0;

        try {
          while (currentTime < duration) {
            video.currentTime = currentTime;
            await new Promise(r => {
              const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                r();
              };
              video.addEventListener('seeked', onSeeked);
            });

            ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
            
            // Convert canvas to blob/base64
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
            const base64 = await this.blobToBase64(blob);
            
            frames.push({
              timestamp: this.formatTimestamp(currentTime),
              base64: base64,
              mimeType: 'image/jpeg'
            });

            currentTime += interval;
          }
          URL.revokeObjectURL(video.src);
          resolve(frames);
        } catch (err) {
          reject(err);
        }
      };

      video.onerror = () => reject(new Error("Failed to load video file."));
    });
  },

  blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.readAsDataURL(blob);
    });
  },

  formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
};

/**
 * UI Controller for the Video Analysis Modal
 */
export const VideoAnalysisModal = {
  currentFile: null,

  show(file) {
    this.currentFile = file;
    elements.videoAnalysisModal.classList.remove('hidden');
    elements.analysisVideoPreview.src = URL.createObjectURL(file);
    elements.analysisPrompt.focus();
    this.init();
  },

  init() {
    if (this.initialized) return;
    
    // Segmented Controls Logic
    const setupSegmented = (selectorId, hiddenInputId) => {
      const container = document.getElementById(selectorId);
      const hiddenInput = document.getElementById(hiddenInputId);
      if (!container || !hiddenInput) return;

      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.seg-btn');
        if (!btn) return;
        
        container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        hiddenInput.value = btn.getAttribute('data-value');
      });
    };

    setupSegmented('resolutionSelector', 'analysisResolution');
    setupSegmented('fpsSelector', 'analysisFPS');

    // Custom Video Controls
    const video = elements.analysisVideoPreview;
    const ppBtn = elements.analysisPlayPauseBtn;
    const muteBtn = elements.analysisMuteBtn;
    const seekerContainer = document.querySelector('#videoAnalysisModal .video-seeker');
    const seekerFill = elements.analysisSeekerFill;

    ppBtn.addEventListener('click', () => {
      if (video.paused) video.play();
      else video.pause();
    });

    muteBtn.addEventListener('click', () => {
      video.muted = !video.muted;
    });

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

    seekerContainer.addEventListener('click', (e) => {
      const rect = seekerContainer.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      video.currentTime = pos * video.duration;
    });

    this.initialized = true;
  },

  hide() {
    this.currentFile = null;
    elements.videoAnalysisModal.classList.add('hidden');
    if (elements.analysisVideoPreview.src) {
      URL.revokeObjectURL(elements.analysisVideoPreview.src);
      elements.analysisVideoPreview.src = '';
    }
    // Clear segments and prompt
    elements.analysisPrompt.value = '';
    elements.analysisSeekerFill.style.width = '0%';
  },

  async getOptions() {
    return new Promise((resolve) => {
      const onConfirm = () => {
        const resolution = elements.analysisResolution.value;
        const fps = parseFloat(elements.analysisFPS.value);
        const promptText = elements.analysisPrompt.value.trim() || "Analyze this video.";
        
        cleanup();
        resolve({ action: 'analyze', resolution, fps, promptText });
      };

      const onCancel = () => {
        cleanup();
        resolve({ action: 'cancel' });
      };

      const cleanup = () => {
        elements.confirmAnalysisBtn.removeEventListener('click', onConfirm);
        elements.cancelAnalysisBtn.removeEventListener('click', onCancel);
        elements.closeAnalysisModalBtn.removeEventListener('click', onCancel);
        this.hide();
      };

      elements.confirmAnalysisBtn.addEventListener('click', onConfirm);
      elements.cancelAnalysisBtn.addEventListener('click', onCancel);
      elements.closeAnalysisModalBtn.addEventListener('click', onCancel);
    });
  }
};
