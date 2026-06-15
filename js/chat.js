/**
 * chat.js
 * Handles UI rendering for chat messages, code blocks, 
 * and dynamic charts.
 */

import { elements, escapeHtml, smartScroll } from './ui.js';
import { state, saveTabsToStorage } from './state.js';
import { getAIProvider } from './api.js';

// Custom Marked Renderer for rich media and code blocks
const renderer = new marked.Renderer();

// Initialize Mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: document.body.classList.contains('dark-theme') ? 'dark' : 'default',
  securityLevel: 'loose',
});

/**
 * Handle LaTeX formulas in text.
 * Replaces $$...$$ with block math and $...$ with inline math using KaTeX.
 */
function renderMath(text) {
  if (typeof text !== 'string') return text;

  let processed = text;
  // Block math: $$ ... $$
  processed = processed.replace(/\$\$(.+?)\$\$/gs, (match, formula) => {
    try {
      return katex.renderToString(formula, { displayMode: true, throwOnError: false });
    } catch (e) {
      return match;
    }
  });
  // Inline math: $ ... $
  processed = processed.replace(/\$(.+?)\$/g, (match, formula) => {
    try {
      return katex.renderToString(formula, { displayMode: false, throwOnError: false });
    } catch (e) {
      return match;
    }
  });
  return processed;
}

/**
 * Preprocesses AI response text to handle literal '\n\n' or '\n' sequences.
 * It splits by code blocks and inline code to prevent altering code blocks.
 */
export function preprocessResponse(text) {
  if (typeof text !== 'string') return text;
  
  // Split by triple backticks to identify code blocks
  const parts = text.split('```');
  for (let i = 0; i < parts.length; i++) {
    // Even indices are outside of code blocks
    if (i % 2 === 0) {
      // Split by single backticks to identify inline code
      const subparts = parts[i].split('`');
      for (let j = 0; j < subparts.length; j++) {
        // Even indices are outside of inline code
        if (j % 2 === 0) {
          subparts[j] = subparts[j].replace(/\\n\\n/g, '\n\n').replace(/\\n/g, '\n');
        }
      }
      parts[i] = subparts.join('`');
    }
  }
  return parts.join('```');
}

/**
 * Renders a collapsible thought section for Ollama/DeepSeek models.
 */
function renderThought(thought) {
  if (!thought) return '';
  return `
    <details class="thought-section">
      <summary class="thought-summary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>AI Reasoning</span>
      </summary>
      <div class="thought-content">${renderMath(marked.parse(preprocessResponse(thought)))}</div>
    </details>
  `;
}

// Configure Marked with modern use() API
marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    code(argsOrCode, language) {
      let code = typeof argsOrCode === 'string' ? argsOrCode : argsOrCode.text;
      let lang = typeof argsOrCode === 'string' ? language : argsOrCode.lang;

      if (lang === 'chart') {
        return `
          <div class="chart-container">
            <canvas class="chart-canvas" data-config="${escapeHtml(code)}"></canvas>
          </div>
        `;
      }

      if (lang === 'mermaid') {
        return `
          <div class="mermaid-container">
            <pre class="mermaid">${escapeHtml(code)}</pre>
          </div>
        `;
      }

      if (lang === 'extrapane-canvas') {
        const lines = code.split('\n');
        const title = lines[0] || 'Untitled Canvas';
        const html = lines.slice(1).join('\n');

        return `
          <div class="canvas-trigger-card" data-title="${escapeHtml(title)}" data-html="${escapeHtml(html)}">
            <div class="canvas-icon-box">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
            </div>
            <div class="canvas-info">
              <h4>${escapeHtml(title)}</h4>
              <p>Generated Document / App • Click to view</p>
            </div>
          </div>
        `;
      }

      if (lang === 'context') {
        return `
          <div class="context-collapse">
            <button class="collapse-trigger">
              <span>Used Context</span>
              <span class="collapse-icon">▼</span>
            </button>
            <div class="collapse-content">
              ${marked.parse(code)}
            </div>
          </div>
        `;
      }

      if (lang === 'extrapane-transcription') {
        return `
          <div class="transcription-container">
            <div class="transcription-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
              <span>Transcription</span>
            </div>
            <div class="transcription-content">
              ${code.split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>
          </div>
        `;
      }

      if (lang === 'extrapane-tts') {
        let textToSpeak = code;
        let styling = '';
        
        try {
          // Attempt to parse as JSON for advanced styling control
          const parsed = JSON.parse(code);
          if (parsed.text) {
            textToSpeak = parsed.text;
            styling = parsed.styling || '';
          }
        } catch (e) {
          // Not JSON, treat as raw text
        }

        return `
          <div class="tts-player" data-text="${escapeHtml(textToSpeak)}" data-styling="${escapeHtml(styling)}">
            <div class="tts-player-content">
              <div class="tts-visualizer">
                <div class="tts-bar"></div>
                <div class="tts-bar"></div>
                <div class="tts-bar"></div>
                <div class="tts-bar"></div>
                <div class="tts-bar"></div>
              </div>
              <div class="tts-controls">
                <button class="tts-control-btn play-pause-btn" title="Play/Pause">
                  <svg class="play-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"></path></svg>
                  <svg class="pause-icon hidden" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                </button>
                <button class="tts-control-btn stop-btn" title="Stop">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>
                </button>
              </div>
              <div class="tts-status">Ready to play</div>
            </div>
          </div>
        `;
      }

      if (lang === 'extrapane-image') {
        const promptText = code.trim();
        return `
          <div class="image-generation-card" data-prompt="${escapeHtml(promptText)}">
            <div class="image-gen-placeholder">
              <div class="loader-spinner"></div>
              <span>Generating Image: "${escapeHtml(promptText.length > 65 ? promptText.substring(0, 65) + '...' : promptText)}"...</span>
            </div>
          </div>
        `;
      }

      const validLanguage = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      const highlighted = hljs.highlight(code, { language: validLanguage }).value;

      return `
        <div class="code-block-container">
          <div class="code-block-header">
            <span>${validLanguage}</span>
            <button class="copy-code-btn" data-code="${escapeHtml(code)}">Copy</button>
          </div>
          <pre><code class="hljs language-${validLanguage}">${highlighted}</code></pre>
        </div>
      `;
    }
  }
});

/**
 * Scans a container for chart canvases and initializes them using Chart.js.
 * @param {HTMLElement} container 
 */
export function renderCharts(container) {
  const chartBlocks = container.querySelectorAll('.chart-canvas');
  const isDark = document.body.classList.contains('dark-theme');

  // Premium, high-contrast palette
  const lightColors = ['#2563eb', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4'];
  const darkColors = ['#3b82f6', '#34d399', '#f87171', '#fbbf24', '#a78bfa', '#22d3ee'];
  const palette = isDark ? darkColors : lightColors;

  chartBlocks.forEach(canvas => {
    if (canvas.getAttribute('data-rendered')) return;
    try {
      const configText = canvas.getAttribute('data-config');
      const config = JSON.parse(configText);

      // 1. Apply Aesthetic Defaults to Datasets
      if (config.data && config.data.datasets) {
        config.data.datasets.forEach((ds, i) => {
          const color = palette[i % palette.length];
          const themeColor = state.userThemeColor || '#2563eb';

          if (!ds.borderColor) ds.borderColor = color;
          if (!ds.backgroundColor) ds.backgroundColor = color + (isDark ? '22' : '1a');
          
          // Hover Effects - Use Theme Color for Branded Interaction
          ds.hoverBackgroundColor = themeColor + (isDark ? '66' : '44');
          ds.hoverBorderColor = themeColor;
          ds.hoverBorderWidth = 2;

          // Type-Specific Enhancements
          if (config.type === 'line') {
            ds.tension = ds.tension ?? 0.4;
            ds.borderWidth = ds.borderWidth ?? 2.5;
            ds.pointRadius = ds.pointRadius ?? 4;
            ds.pointHoverRadius = ds.pointHoverRadius ?? 7;
            ds.pointBackgroundColor = color;
            ds.pointHoverBackgroundColor = themeColor;
            ds.pointBorderWidth = 2;
            ds.pointHoverBorderWidth = 3;
          }

          if (config.type === 'bar') {
            ds.borderRadius = ds.borderRadius ?? 6;
            ds.borderSkipped = false;
          }

          if (config.type === 'pie' || config.type === 'doughnut') {
            ds.hoverOffset = 15;
            ds.borderWidth = 2;
            ds.borderColor = isDark ? '#0f172a' : '#fff';
            ds.hoverBorderColor = themeColor;
          }
        });
      }

      // 2. Premium Global Options
      const defaultOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: config.data.datasets.length > 1,
            position: 'top',
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              font: { family: "'Inter', sans-serif", size: 11, weight: '500' },
              color: isDark ? '#94a3b8' : '#64748b',
              padding: 20
            }
          },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#475569',
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 12,
            displayColors: true,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { weight: '700' },
            shadowBlur: 10,
            shadowColor: 'rgba(0,0,0,0.1)'
          }
        },
        scales: config.type !== 'pie' && config.type !== 'doughnut' ? {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: "'Inter', sans-serif", size: 11 },
              color: isDark ? '#64748b' : '#94a3b8',
              padding: 10
            }
          },
          y: {
            grid: {
              color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              drawBorder: false
            },
            ticks: {
              font: { family: "'Inter', sans-serif", size: 11 },
              color: isDark ? '#64748b' : '#94a3b8',
              padding: 10
            }
          }
        } : {}
      };

      // Merge defaults with AI-provided options
      config.options = { ...defaultOptions, ...config.options };

      // Force typography in case AI tried to override it poorly
      Chart.defaults.font.family = "'Inter', sans-serif";

      new Chart(canvas, config);
      canvas.setAttribute('data-rendered', 'true');
    } catch (e) {
      console.error("Failed to render chart:", e);
      canvas.parentElement.innerHTML = `<div class="error-bubble"><b>Visualization Error:</b> ${e.message}</div>`;
    }
  });
}

/**
 * Scans a container for mermaid blocks and initializes them.
 * @param {HTMLElement} container 
 */
export async function renderDiagrams(container) {
  const mermaidBlocks = container.querySelectorAll('.mermaid');
  if (mermaidBlocks.length > 0) {
    try {
      await mermaid.run({
        nodes: mermaidBlocks,
      });
    } catch (e) {
      console.error("Failed to render mermaid diagram:", e);
    }
  }
}

/** Displays the initial onboarding/welcome card. */
export function showWelcomeMessage() {
  const welcomeHTML = `
    <div class="welcome-card">
      <div class="welcome-header">
        <h1>Get Started with Extrapane AI</h1>
        <p>A minimalist tool to extract and chat with any webpage content.</p>
      </div>
      
      <div class="welcome-features">
        <div class="feature-item">
          <div class="feature-icon">1</div>
          <div class="feature-info">
            <h3>Enter Extract Mode</h3>
            <p>Click the <b>(+)</b> icon in the input area to start selecting elements.</p>
          </div>
        </div>
        
        <div class="feature-item">
          <div class="feature-icon">2</div>
          <div class="feature-info">
            <h3>Select Context</h3>
            <p>Hover and click on any text, images, or elements you want to analyze.</p>
          </div>
        </div>
        
        <div class="feature-item">
          <div class="feature-icon">3</div>
          <div class="feature-info">
            <h3>Analyze & Chat</h3>
            <p>Press <b>Esc</b> to finish, then ask Gemini to explain, summarize, or visualize.</p>
          </div>
        </div>
      </div>
      
      <div class="welcome-footer">
        <b>Tip:</b> You can extract multiple elements from different parts of the page!
      </div>
    </div>
  `;
  if (!elements.chatHistory) {
    console.error("chatHistory element not found!");
    return;
  }
  elements.chatHistory.innerHTML = welcomeHTML;
}

export function clearWelcomeCard() {
  const welcomeCard = elements.chatHistory.querySelector('.welcome-card');
  if (welcomeCard) {
    welcomeCard.remove();
  }
}

/**
 * Appends a static message (user or finalized AI) to the chat.
 * Now supports optional video attachments for persistence.
 * @returns {HTMLElement} The message container
 */
export function appendMessage(sender, htmlContent, index, videoData, usage, contextSummary, thought, markdown) {
  clearWelcomeCard();
  const isAI = sender === 'AI';
  const container = document.createElement('div');
  container.className = `message ${isAI ? 'ai' : 'user'}`;
  if (index !== undefined) container.setAttribute('data-index', index);
  if (markdown !== undefined) container.markdownText = markdown;

  const thoughtHtml = (isAI && thought) ? renderThought(thought) : '';

  let videoHtml = '';
  // Only show video/audio/images/PDFs/web links in the user's prompt message to avoid redundancy
  if (videoData && !isAI) {
    const mediaArray = Array.isArray(videoData) ? videoData : [videoData];
    mediaArray.forEach(media => {
      if (!media) return;
      if (media.type && media.type.startsWith('audio/')) {
        videoHtml += `
          <div class="message-audio-container">
            <audio src="${media.src || ''}" controls></audio>
          </div>
        `;
      } else if (media.type === 'video/youtube' || media.src?.includes('youtube.com') || media.src?.includes('youtu.be')) {
        const videoId = dataToYoutubeId(media.src);
        videoHtml += `
          <div class="message-video-container">
            <iframe src="https://www.youtube-nocookie.com/embed/${videoId}" frameborder="0" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
          </div>
        `;
      } else if (media.type && media.type.startsWith('image/')) {
        videoHtml += `
          <div class="message-image-container">
            <img src="${media.src || ''}" alt="Linked Image" />
          </div>
        `;
      } else if (media.type === 'application/pdf' || media.isPdf) {
        const pdfName = media.src ? media.src.split('/').pop() : 'document.pdf';
        videoHtml += `
          <div class="message-pdf-container">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #ef4444;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            <span>PDF: ${escapeHtml(pdfName)}</span>
          </div>
        `;
      } else if (media.isText || (media.type && (media.type.startsWith('text/') || media.type.includes('html') || media.type.includes('json')))) {
        videoHtml += `
          <div class="message-link-container">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            <span>Web Link: ${escapeHtml(media.src)}</span>
          </div>
        `;
      } else {
        videoHtml += `
          <div class="message-video-container">
            <video src="${media.src || ''}" controls></video>
          </div>
        `;
      }
    });
  }

  let contextHtml = '';
  if (!isAI && contextSummary && contextSummary.length > 0) {
    const detailItems = contextSummary.map(c => `<li><b>${c.tag}:</b> ${c.name || '(No name)'}</li>`).join('');
    contextHtml = `
      <div class="message-context-tag">
        <div class="context-tag-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>${contextSummary.length} Context Chip${contextSummary.length > 1 ? 's' : ''}</span>
          <svg class="context-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="message-context-details hidden">
          <ul>${detailItems}</ul>
        </div>
      </div>
    `;
  }

  const actionsHtml = `
    <div class="message-actions">
      <button class="msg-action-btn copy-btn" data-tooltip="Copy message" data-tooltip-position="top-left">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      </button>
      ${!isAI ? `
        <button class="msg-action-btn edit-btn-trigger" data-tooltip="Edit message" data-tooltip-position="top-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
      ` : `
        <button class="msg-action-btn retry-btn" data-tooltip="Save & Retry" data-tooltip-position="top-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
      `}
    </div>
  `;

  let usageHtml = '';
  if (isAI && usage) {
    const { promptTokenCount, candidatesTokenCount, totalTokenCount } = usage;
    usageHtml = `
      <div class="message-usage" title="Input: ${promptTokenCount} | Output: ${candidatesTokenCount}">
        ${totalTokenCount} tokens
      </div>
    `;
  }

  container.innerHTML = `
    <div class="message-content">
      ${videoHtml}
      ${contextHtml}
      ${thoughtHtml}
      <div class="message-text">${htmlContent}</div>
      ${usageHtml}
    </div>
    ${actionsHtml}
    ${!isAI ? '<div class="edit-area"></div>' : ''}
  `;

  elements.chatHistory.appendChild(container);

  // Re-hydrate video/audio if needed
  const rehydrateArray = Array.isArray(videoData) ? videoData : (videoData ? [videoData] : []);
  rehydrateArray.forEach((media, mediaIndex) => {
    if (media.mediaId && !media.src) {
      getMedia(media.mediaId).then(blob => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const videos = container.querySelectorAll('video');
          const audios = container.querySelectorAll('audio');
          
          const video = videos[mediaIndex] || videos[0];
          if (video) video.src = url;
          const audio = audios[mediaIndex] || audios[0];
          if (audio) audio.src = url;
        }
      });
    }
  });

  if (isAI) {
    renderCharts(container);
    renderDiagrams(container);
    renderGeneratedImages(container);

    const textEl = container.querySelector('.message-text');
    if (textEl && index !== undefined) {
      const blocks = Array.from(textEl.children);
      blocks.forEach((block, blockIndex) => {
        const tag = block.tagName.toLowerCase();
        if (['p', 'ul', 'ol', 'pre', 'blockquote', 'h1', 'h2', 'h3'].includes(tag)) {
          block.setAttribute('data-block-index', blockIndex);

          const btn = document.createElement('button');
          btn.className = 'inline-ask-btn';
          btn.title = 'Ask related question';
          btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
          btn.onclick = (e) => {
            e.stopPropagation();
            showInlineInput(block, index, blockIndex);
          };
          block.appendChild(btn);
        }
      });

      const currentTab = state.tabs.find(t => t.id === state.activeTabId);
      const msgObj = currentTab?.history[index];
      if (msgObj && msgObj.subConversations) {
        msgObj.subConversations.forEach(sub => {
          const blockEl = textEl.querySelector(`[data-block-index="${sub.blockIndex}"]`);
          if (blockEl) {
            renderSubConversationBox(blockEl, index, sub.blockIndex, sub.question, sub.answer, sub.collapsed);
          }
        });
      }
    }
  }

  return container;
}

/**
 * Creates a streaming AI message bubble with update/finalize controls.
 * @returns {Object} Control methods {update, finalize}
 */
export function appendStreamingMessage(index) {
  clearWelcomeCard();
  const container = document.createElement('div');
  container.className = 'message ai streaming';
  if (index !== undefined) container.setAttribute('data-index', index);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content is-thinking';
  contentDiv.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
    <span class="thinking-text">Responding</span>
  `;
  container.appendChild(contentDiv);

  elements.chatHistory.appendChild(container);
  smartScroll();

  return {
    update: (markdownText, currentThought) => {
      if (contentDiv.classList.contains('is-thinking')) {
        contentDiv.classList.remove('is-thinking');
      }
      const thoughtHtml = currentThought ? renderThought(currentThought) : '';
      contentDiv.innerHTML = thoughtHtml + renderMath(marked.parse(preprocessResponse(markdownText)));
      container.markdownText = markdownText;
      smartScroll();
    },
    finalize: (finalText, usage, finalThought) => {
      container.classList.remove('streaming');
      contentDiv.classList.remove('is-thinking');
      
      let usageHtml = '';
      if (usage) {
        usageHtml = `<div class="message-usage" title="Input: ${usage.promptTokenCount} | Output: ${usage.candidatesTokenCount}">${usage.totalTokenCount} tokens</div>`;
      }

      const thoughtHtml = finalThought ? renderThought(finalThought) : '';
      contentDiv.innerHTML = thoughtHtml + renderMath(marked.parse(preprocessResponse(finalText))) + usageHtml;
      
      container.markdownText = finalText;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions';
      actionsDiv.innerHTML = `
        <button class="msg-action-btn copy-btn" data-tooltip="Copy message" data-tooltip-position="top-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button class="msg-action-btn retry-btn" data-tooltip="Save & Retry" data-tooltip-position="top-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
      `;
      container.appendChild(actionsDiv);

      renderCharts(contentDiv);
      renderDiagrams(contentDiv);
      renderGeneratedImages(contentDiv);
      smartScroll();
    }
  };
}

/**
 * Creates a special background task message with a progress bar and video preview.
 */
import { saveMedia, getMedia } from './mediaStore.js';

/**
 * Creates a special background task message with a progress bar and video preview.
 * Now supports persistence by saving task state to the tab history and binary data to IndexedDB.
 */
export function appendProgressMessage(sender, taskName, videoData, taskId, tabId) {
  clearWelcomeCard();

  // 1. Ensure task exists in history for persistence
  const tab = state.tabs.find(t => t.id === tabId) || { history: [] };
  let historyEntry = tab.history.find(m => m.taskId === taskId);

  if (!historyEntry) {
    historyEntry = {
      role: 'assistant',
      type: 'task',
      taskId: taskId,
      taskName: taskName,
      videoData: { ...videoData }, // Clone to avoid mutation issues
      progress: 0,
      statusText: 'Initializing...',
      sender: sender
    };

    // If we have a raw blob/file, save it to persistent store
    if (videoData && videoData.file) {
      saveMedia(videoData.file).then(mediaId => {
        historyEntry.videoData.mediaId = mediaId;
        delete historyEntry.videoData.file; // Don't store large blobs in chrome.storage
        saveTabsToStorage();
      });
    }

    tab.history.push(historyEntry);
    saveTabsToStorage();
  }

  const container = document.createElement('div');
  container.className = `message ${sender.toLowerCase()} task-message`;
  container.setAttribute('data-task-id', taskId);

  // Set data-index so copy and retry actions are correctly indexed
  const index = tab.history.indexOf(historyEntry);
  if (index !== -1) container.setAttribute('data-index', index);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  contentDiv.innerHTML = `
    <div class="task-info">
      <div class="task-title"><b>Task:</b> ${escapeHtml(taskName)}</div>
      <div class="progress-container">
        <div class="progress-bar" style="width: ${historyEntry.progress}%"></div>
      </div>
      <div class="progress-status">${escapeHtml(historyEntry.statusText)}</div>
    </div>
  `;
  container.appendChild(contentDiv);
  elements.chatHistory.appendChild(container);

  const bar = contentDiv.querySelector('.progress-bar');
  const status = contentDiv.querySelector('.progress-status');
  smartScroll();

  return {
    update: (percent, statusText) => {
      // Update DOM
      if (bar) bar.style.width = `${percent}%`;
      if (statusText && status) status.innerText = statusText;

      // Update Persistent History
      historyEntry.progress = percent;
      historyEntry.statusText = statusText;

      // Update Global Task State for badges
      const globalTask = state.tasks.find(t => t.id === taskId);
      if (globalTask) {
        globalTask.progress = percent;
        globalTask.status = statusText;
      }

      smartScroll();
    },
    finalize: (finalText, usage) => {
      // Remove Task UI
      const taskInfo = contentDiv.querySelector('.task-info');
      if (taskInfo) taskInfo.remove();

      let usageHtml = '';
      if (usage) {
        usageHtml = `<div class="message-usage" title="Input: ${usage.promptTokenCount} | Output: ${usage.candidatesTokenCount}">${usage.totalTokenCount} tokens</div>`;
      }

      // Add Result
      const responseContent = document.createElement('div');
      responseContent.className = 'response-text';
      responseContent.innerHTML = renderMath(marked.parse(preprocessResponse(finalText))) + usageHtml;
      contentDiv.appendChild(responseContent);

      container.markdownText = finalText;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions';
      actionsDiv.innerHTML = `
        <button class="msg-action-btn copy-btn" data-tooltip="Copy message" data-tooltip-position="top-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button class="msg-action-btn retry-btn" data-tooltip="Save & Retry" data-tooltip-position="top-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
      `;
      container.appendChild(actionsDiv);

      // Convert history entry to a normal message
      historyEntry.role = 'model';
      historyEntry.type = 'chat';
      historyEntry.parts = [{ text: finalText }];
      historyEntry.usage = usage;
      delete historyEntry.taskId;
      delete historyEntry.progress;
      delete historyEntry.statusText;
      delete historyEntry.taskName;
      // We keep videoData for persistence!

      // Remove from global tasks to stop badge pulsing
      state.tasks = state.tasks.filter(t => t.id !== taskId);
      window.dispatchEvent(new CustomEvent('task-updated'));

      saveTabsToStorage();
      renderCharts(contentDiv);
      renderDiagrams(contentDiv);
      renderGeneratedImages(contentDiv);
      smartScroll();
    },
    error: (errorMessage) => {
      const taskInfo = contentDiv.querySelector('.task-info');
      if (taskInfo) {
        taskInfo.innerHTML = `
          <div class="error-bubble">
            <b>Analysis Failed:</b> ${escapeHtml(errorMessage)}
          </div>
        `;
      }

      // Update history
      historyEntry.statusText = 'Failed: ' + errorMessage;

      // Remove from global tasks
      state.tasks = state.tasks.filter(t => t.id !== taskId);
      window.dispatchEvent(new CustomEvent('task-updated'));

      saveTabsToStorage();
      smartScroll();
    }
  };
}

function dataToYoutubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=))([^"&?\/\s]{11})/);
  return (match && match[1]) ? match[1] : '';
}

export async function renderGeneratedImages(container) {
  const cards = container.querySelectorAll('.image-generation-card:not([data-rendered])');
  
  for (const card of cards) {
    card.setAttribute('data-rendered', 'true');
    const promptText = card.getAttribute('data-prompt');
    
    try {
      let base64Image = '';
      
      const isOllama = state.userModel.startsWith('ollama');
      if (!isOllama && state.userApiKey) {
        const provider = getAIProvider(state.userModel);
        if (provider.generateImage) {
          base64Image = await provider.generateImage(state.userApiKey, promptText);
        }
      }
      
      if (!base64Image) {
        // Fallback to Pollinations.ai
        const response = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=512&height=512&nologo=true`);
        if (!response.ok) throw new Error("Failed to generate image via fallback provider.");
        const blob = await response.blob();
        
        base64Image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      
      card.innerHTML = `
        <div class="image-gen-result">
          <img src="data:image/jpeg;base64,${base64Image}" alt="${escapeHtml(promptText)}" />
          <div class="image-gen-overlay">
            <button class="image-action-btn view-canvas-btn" data-title="${escapeHtml(promptText)}" data-image="${base64Image}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
              Canvas View
            </button>
            <button class="image-action-btn download-image-btn" data-filename="generated-image.jpg" data-image="${base64Image}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Download
            </button>
          </div>
        </div>
      `;
      smartScroll();
    } catch (err) {
      console.error("Image generation failed:", err);
      card.innerHTML = `
        <div class="error-bubble">
          <b>Image Generation Failed:</b> ${escapeHtml(err.message)}
        </div>
      `;
      smartScroll();
    }
  }
}

/**
 * Appends a GitHub file selector card to the chat history and returns an object
 * with control methods (updateStatus, populateFiles) to drive the card's state.
 */
export function appendGitHubSelectorMessage(index, owner, repo) {
  clearWelcomeCard();
  const container = document.createElement('div');
  container.className = 'message ai';
  if (index !== undefined) container.setAttribute('data-index', index);

  container.innerHTML = `
    <div class="message-content">
      <div class="github-selector-card" style="margin: 4px 0; padding: 16px; background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 12px; width: 100%;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
          <span style="font-weight: 700; font-family: var(--font-display); font-size: 1.1rem; color: var(--text-main);">${escapeHtml(owner)}/${escapeHtml(repo)}</span>
        </div>
        
        <div class="repo-status" style="display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: var(--text-muted);">
          <div class="loader-spinner" style="width: 14px; height: 14px; border-width: 2px; border-style: solid; border-color: var(--accent-primary) transparent transparent transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span>Downloading and analyzing repository...</span>
        </div>
        
        <div class="file-selection-area hidden" style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" class="repo-search-input" placeholder="Search files..." style="flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-main); font-size: 0.85rem; outline: none; transition: border 0.2s;" />
            <button class="repo-toggle-all" style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-main); font-size: 0.8rem; cursor: pointer; font-weight: 600; white-space: nowrap;">Toggle All</button>
          </div>
          
          <div class="repo-file-checklist" style="max-height: 180px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; background: var(--bg-color); font-family: monospace; font-size: 0.8rem;">
            <!-- Files checkboxes go here -->
          </div>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border-color);">
            <span class="repo-selected-info" style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">0 files selected</span>
            <button class="repo-submit-btn" style="padding: 10px 18px; border-radius: 10px; border: none; background: var(--gradient-main); color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2); transition: transform 0.2s;">Analyze Codebase</button>
          </div>
        </div>
      </div>
    </div>
  `;

  elements.chatHistory.appendChild(container);
  smartScroll();

  return {
    element: container,
    updateStatus(message, isError = false) {
      const statusEl = container.querySelector('.repo-status');
      if (statusEl) {
        if (isError) {
          statusEl.innerHTML = `
            <span style="color: #ef4444; font-weight: 500;">⚠️ Error: ${escapeHtml(message)}</span>
          `;
        } else {
          statusEl.querySelector('span').innerText = message;
        }
      }
    },
    populateFiles(files, onSubmit) {
      const statusEl = container.querySelector('.repo-status');
      if (statusEl) statusEl.classList.add('hidden');

      const selectionArea = container.querySelector('.file-selection-area');
      selectionArea.classList.remove('hidden');

      const checklist = container.querySelector('.repo-file-checklist');
      checklist.innerHTML = '';

      files.forEach((file, idx) => {
        const item = document.createElement('label');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.cursor = 'pointer';
        item.style.userSelect = 'none';
        item.style.padding = '2px 4px';
        item.style.borderRadius = '4px';
        item.style.transition = 'background 0.2s';
        
        item.onmouseover = () => item.style.background = 'var(--bg-secondary)';
        item.onmouseout = () => item.style.background = 'transparent';

        const shouldPrecheck = file.content.length < 50000;

        item.innerHTML = `
          <input type="checkbox" data-index="${idx}" ${shouldPrecheck ? 'checked' : ''} style="cursor: pointer;" />
          <span style="color: var(--text-main); word-break: break-all;">${escapeHtml(file.path)}</span>
          <span style="color: var(--text-muted); margin-left: auto; font-size: 0.75rem;">(${(file.content.length / 1024).toFixed(1)} KB)</span>
        `;
        checklist.appendChild(item);
      });

      const updateSelectedCount = () => {
        const checked = checklist.querySelectorAll('input[type="checkbox"]:checked');
        container.querySelector('.repo-selected-info').innerText = `${checked.length} of ${files.length} selected`;
      };
      updateSelectedCount();

      checklist.addEventListener('change', updateSelectedCount);

      const searchInput = container.querySelector('.repo-search-input');
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        checklist.querySelectorAll('label').forEach(label => {
          const path = label.querySelector('span').innerText.toLowerCase();
          if (path.includes(query)) {
            label.style.display = 'flex';
          } else {
            label.style.display = 'none';
          }
        });
      });

      let allChecked = true;
      const toggleBtn = container.querySelector('.repo-toggle-all');
      toggleBtn.addEventListener('click', () => {
        const checkboxes = checklist.querySelectorAll('input[type="checkbox"]');
        allChecked = !allChecked;
        checkboxes.forEach(cb => {
          if (cb.closest('label').style.display !== 'none') {
            cb.checked = allChecked;
          }
        });
        updateSelectedCount();
      });

      const submitBtn = container.querySelector('.repo-submit-btn');
      submitBtn.addEventListener('click', () => {
        const checkedBoxes = checklist.querySelectorAll('input[type="checkbox"]:checked');
        const selected = Array.from(checkedBoxes).map(cb => {
          const idx = parseInt(cb.getAttribute('data-index'));
          return files[idx];
        });

        selectionArea.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-primary); font-size: 0.9rem; font-weight: 600; padding: 4px 0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Analyzing ${selected.length} code files...</span>
          </div>
        `;
        smartScroll();

        onSubmit(selected);
      });
    }
  };
}

let onInlineQuestionSubmit = null;
export function setInlineQuestionCallback(callback) {
  onInlineQuestionSubmit = callback;
}

function showInlineInput(block, messageIndex, blockIndex) {
  if (block.nextElementSibling?.classList.contains('inline-input-container')) return;

  const inputContainer = document.createElement('div');
  inputContainer.className = 'inline-input-container';

  inputContainer.innerHTML = `
    <input type="text" class="inline-input" placeholder="Ask a related question..." style="flex: 1; border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; outline: none; background: var(--bg-color); color: var(--text-main);" />
    <button class="inline-submit-btn" style="padding: 8px 14px; border-radius: 8px; border: none; background: var(--gradient-main); color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer;">Ask</button>
    <button class="inline-cancel-btn" style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; font-weight: 500;">Cancel</button>
  `;

  block.parentNode.insertBefore(inputContainer, block.nextSibling);

  const inputEl = inputContainer.querySelector('.inline-input');
  inputEl.focus();

  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter') inputContainer.querySelector('.inline-submit-btn').click();
  };

  inputContainer.querySelector('.inline-cancel-btn').onclick = () => inputContainer.remove();

  inputContainer.querySelector('.inline-submit-btn').onclick = () => {
    const question = inputEl.value;
    if (question.trim() && onInlineQuestionSubmit) {
      onInlineQuestionSubmit(messageIndex, blockIndex, block, question);
      inputContainer.remove();
    }
  };
}

export function renderSubConversationBox(blockEl, messageIndex, blockIndex, question, answer, collapsed) {
  let subConvContainer = blockEl.nextElementSibling;
  if (subConvContainer && subConvContainer.classList.contains('sub-conv-container')) {
    subConvContainer.remove();
  }

  subConvContainer = document.createElement('div');
  subConvContainer.className = `sub-conv-container ${collapsed ? 'collapsed' : ''}`;
  subConvContainer.setAttribute('data-block-index', blockIndex);

  subConvContainer.innerHTML = `
    <div class="sub-conv-header">
      <span style="font-weight: 700; display: flex; align-items: center; gap: 4px; color: var(--accent-primary);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        Sub-discussion
      </span>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button class="sub-conv-action-btn toggle">${collapsed ? 'Expand' : 'Collapse'}</button>
        <button class="sub-conv-action-btn delete">Delete</button>
      </div>
    </div>
    <div class="sub-conv-body">
      <div class="sub-conv-question">Q: ${escapeHtml(question)}</div>
      <div class="sub-conv-answer">${answer}</div>
    </div>
  `;

  blockEl.parentNode.insertBefore(subConvContainer, blockEl.nextSibling);

  subConvContainer.querySelector('.sub-conv-action-btn.toggle').onclick = () => {
    const isCollapsed = subConvContainer.classList.toggle('collapsed');
    subConvContainer.querySelector('.sub-conv-action-btn.toggle').innerText = isCollapsed ? 'Expand' : 'Collapse';
    
    const currentTab = state.tabs.find(t => t.id === state.activeTabId);
    const msg = currentTab?.history[messageIndex];
    if (msg && msg.subConversations) {
      const sub = msg.subConversations.find(s => s.blockIndex === blockIndex);
      if (sub) {
        sub.collapsed = isCollapsed;
        saveTabsToStorage();
      }
    }
  };

  subConvContainer.querySelector('.sub-conv-action-btn.delete').onclick = () => {
    subConvContainer.remove();
    const currentTab = state.tabs.find(t => t.id === state.activeTabId);
    const msg = currentTab?.history[messageIndex];
    if (msg && msg.subConversations) {
      msg.subConversations = msg.subConversations.filter(s => s.blockIndex !== blockIndex);
      saveTabsToStorage();
      showToast("Sub-discussion deleted.");
    }
  };

  return subConvContainer;
}


