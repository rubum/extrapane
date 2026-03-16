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
  const lightColors = ['#6366f1', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6', '#06b6d4'];
  const darkColors = ['#818cf8', '#34d399', '#fb7185', '#fbbf24', '#a78bfa', '#22d3ee'];
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
          
          if (!ds.borderColor) ds.borderColor = color;
          if (!ds.backgroundColor) ds.backgroundColor = color + (isDark ? '33' : '22');
          
          // Line smoothing and precision
          if (config.type === 'line') {
            ds.tension = ds.tension ?? 0.4;
            ds.borderWidth = ds.borderWidth ?? 2.5;
            ds.pointRadius = ds.pointRadius ?? 4;
            ds.pointHoverRadius = ds.pointHoverRadius ?? 6;
            ds.pointBackgroundColor = '#fff';
            ds.pointBorderWidth = 2;
          }
          
          if (config.type === 'bar') {
            ds.borderRadius = ds.borderRadius ?? 6;
            ds.borderWidth = 0;
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
