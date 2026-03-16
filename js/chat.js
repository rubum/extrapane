/**
 * chat.js
 * Handles UI rendering for chat messages, code blocks, 
 * and dynamic charts.
 */

import { elements, escapeHtml, smartScroll } from './ui.js';

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
  chartBlocks.forEach(canvas => {
    if (canvas.getAttribute('data-rendered')) return;
    try {
      const configText = canvas.getAttribute('data-config');
      const config = JSON.parse(configText);

      // Apply theme-aware colors if not specified
      if (config.data && config.data.datasets) {
        config.data.datasets.forEach((ds, i) => {
          if (!ds.backgroundColor) {
            const isDark = document.body.classList.contains('dark-theme');
            const lightColors = ['#3b82f6', '#0ea5e9', '#0891b2', '#2dd4bf', '#10b981'];
            const darkColors = ['#60a5fa', '#38bdf8', '#22d3ee', '#2dd4bf', '#34d399'];
            const palette = isDark ? darkColors : lightColors;

            ds.backgroundColor = palette[i % palette.length] + (isDark ? '60' : '40');
            ds.borderColor = palette[i % palette.length];
            ds.borderWidth = 2;
          }
        });
      }

      if (!config.options) config.options = {};
      config.options.maintainAspectRatio = false;

      new Chart(canvas, config);
      canvas.setAttribute('data-rendered', 'true');
    } catch (e) {
      console.error("Failed to render chart:", e);
      canvas.parentElement.innerHTML = `<div style="color: #ff4757; font-size: 12px; padding: 10px;">Failed to render chart: ${e.message}</div>`;
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
 * @returns {HTMLElement} The message container
 */
export function appendMessage(sender, htmlContent, index) {
  clearWelcomeCard();
  const isAI = sender === 'AI';
  const container = document.createElement('div');
  container.className = `message ${isAI ? 'ai' : 'user'}`;
  if (index !== undefined) container.setAttribute('data-index', index);

  const actionsHtml = `
    <div class="message-actions">
      <button class="msg-action-btn copy-btn" title="Copy message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      </button>
      ${!isAI ? `
        <button class="msg-action-btn edit-btn-trigger" title="Edit message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
      ` : `
        <button class="msg-action-btn retry-btn" title="Save & Retry">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
      `}
    </div>
  `;

  container.innerHTML = `
    <div class="message-content">${htmlContent}</div>
    ${actionsHtml}
    ${!isAI ? '<div class="edit-area"></div>' : ''}
  `;

  elements.chatHistory.appendChild(container);

  if (isAI) {
    renderCharts(container);
    renderDiagrams(container);
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
    update: (markdownText) => {
      if (contentDiv.classList.contains('is-thinking')) {
        contentDiv.classList.remove('is-thinking');
      }
      contentDiv.innerHTML = renderMath(marked.parse(markdownText));
      smartScroll();
    },
    finalize: (finalText) => {
      container.classList.remove('streaming');
      contentDiv.classList.remove('is-thinking');
      contentDiv.innerHTML = renderMath(marked.parse(finalText));
      renderCharts(contentDiv);
      renderDiagrams(contentDiv);
      smartScroll();
    }
  };
}
