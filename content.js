/**
 * content.js
 * Injected script responsible for visual element selection
 * and extracting data from the active webpage.
 */

let isSelectionMode = false;
let currentHighlightedElement = null;

// Apply theme color dynamically
function applyContentThemeColor(hex) {
  if (!hex) return;
  // Convert hex to rgb
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 210;
  const b = parseInt(hex.slice(5, 7), 16) || 255;
  
  const root = document.documentElement;
  root.style.setProperty('--extrapane-theme-color', hex);
  root.style.setProperty('--extrapane-theme-bg', `rgba(${r}, ${g}, ${b}, 0.2)`);
  root.style.setProperty('--extrapane-theme-shadow', `rgba(${r}, ${g}, ${b}, 0.5)`);
}

chrome.storage.local.get(['userThemeColor'], (res) => {
  if (res.userThemeColor) {
    applyContentThemeColor(res.userThemeColor);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.userThemeColor) {
    applyContentThemeColor(changes.userThemeColor.newValue);
  }
});

// Routing for commands from background/sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);
  if (message.type === 'PING') {
    sendResponse({ pong: true });
    return true;
  }

  if (message.type === 'START_SELECTION') {
    startSelectionMode();
  } else if (message.type === 'STOP_SELECTION') {
    stopSelectionMode();
  } else if (message.type === 'GET_PAGE_PDFS') {
    const pdfSelector = 'embed[type*="pdf"], iframe[src*=".pdf"], object[type*="pdf"], a[href*=".pdf"], iframe[type="application/pdf"]';
    let pdfEl = document.querySelector(pdfSelector);

    // Check for Chrome's internal PDF extension wrapper which often uses about:blank or hidden src
    const hasPdfTemplate = !!document.querySelector('template[shadowrootmode]');
    const isExtensionViewer = window.location.protocol === 'chrome-extension:' || document.contentType === 'application/pdf';

    if (pdfEl || hasPdfTemplate || isExtensionViewer) {
      const url = (pdfEl ? (pdfEl.getAttribute('original-url') || pdfEl.src || pdfEl.data || pdfEl.href) : null) || window.location.href;

      // If we found an iframe but it's about:blank, the real URL is the page URL in these viewers
      const finalUrl = (url === 'about:blank') ? window.location.href : url;

      sendResponse({
        pdfUrl: finalUrl,
        pdfName: finalUrl.split('/').pop().split('?')[0] || 'document.pdf'
      });
      return;
    }
    sendResponse(null);
  }
  return true; // Keep channel open for async response
});

/** @returns {boolean} Whether the extension context is still alive */
function isContextValid() {
  return !!(chrome.runtime && chrome.runtime.id);
}

/** Sends a message to the sidepanel with context validation */
function safeSendMessage(message) {
  if (isContextValid()) {
    try {
      chrome.runtime.sendMessage(message);
    } catch (e) {
      console.warn("Extrapane: Connection lost, cleaning up.");
      stopSelectionMode();
    }
  } else {
    stopSelectionMode();
  }
}

/** Activates element highlighting and click capturing */
function startSelectionMode() {
  if (isSelectionMode) return;
  if (!isContextValid()) return;

  isSelectionMode = true;
  document.body.classList.add('panelat-selection-mode');

  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
}

/** Deactivates all selection features and cleans up UI */
function stopSelectionMode() {
  isSelectionMode = false;
  document.body.classList.remove('panelat-selection-mode');

  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove('panelat-highlight-hover');
    currentHighlightedElement = null;
  }

  document.removeEventListener('mouseover', handleMouseOver, true);
  document.removeEventListener('mouseout', handleMouseOut, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
}

function handleKeyDown(e) {
  if (!isContextValid()) {
    stopSelectionMode();
    return;
  }

  if (e.key === 'Escape') {
    stopSelectionMode();
    safeSendMessage({ type: 'SELECTION_CANCELLED' });
  }
}

function handleMouseOver(e) {
  if (!isSelectionMode) return;
  if (!isContextValid()) {
    stopSelectionMode();
    return;
  }

  const path = e.composedPath();
  const target = path[0];

  if (!target || target === document.body || target === document.documentElement) return;
  if (target.closest && target.closest('.panelat-highlight-hover')) return;

  if (currentHighlightedElement && currentHighlightedElement !== target) {
    currentHighlightedElement.classList.remove('panelat-highlight-hover');
  }

  currentHighlightedElement = target;
  currentHighlightedElement.classList.add('panelat-highlight-hover');
}

function handleMouseOut(e) {
  if (!isSelectionMode) return;
  const path = e.composedPath();
  const target = path[0];

  if (currentHighlightedElement === target) {
    currentHighlightedElement.classList.remove('panelat-highlight-hover');
  }
}

/** Extracts elements details upon click and sends to sidepanel */
function handleClick(e) {
  console.log("Handling click to element", e);
  if (!isSelectionMode) return;
  if (!isContextValid()) {
    stopSelectionMode();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const path = e.composedPath();
  let target = path[0];

  if (!target) return;

  target.classList.remove('panelat-highlight-hover');

  let imgTargets = [];

  if (target.tagName && target.tagName.toLowerCase() === 'img') {
    imgTargets.push(target);
  } else {
    // Collect all images within the explicit click target container
    if (target.querySelectorAll) {
      const children = Array.from(target.querySelectorAll('img'));
      if (children.length > 0) {
        imgTargets.push(...children);
      }
    }

    if (imgTargets.length === 0) {
      // Check visually under the cursor to bypass transparent overlays 
      const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
      const imgAtPoint = elementsAtPoint.find(el => el.tagName && el.tagName.toLowerCase() === 'img');
      if (imgAtPoint) imgTargets.push(imgAtPoint);
    }

    if (imgTargets.length === 0) {
      // Check if the image is anywhere in the direct click path
      const imgInPath = path.find(el => el.tagName && el.tagName.toLowerCase() === 'img');
      if (imgInPath) imgTargets.push(imgInPath);
    }
  }

  console.log("Extrapane: Image extraction check -> Click target:", target);
  console.log("Extrapane: Image extraction check -> Selected imgTargets:", imgTargets);

  let extractedData = {
    tag: target.tagName,
    html: target.outerHTML,
    id: target.id,
    className: typeof target.className === 'string' ? target.className : ''
  };

  if (imgTargets.length > 0) {
    console.log("we found images", imgTargets);
    /**
     * What: Extract multiple image sources and alt texts directly.
     * Why: Users expect all visual context inside a container to be gathered.
     */
    extractedData.images = imgTargets.map(img => {
      return {
        src: img.currentSrc || img.src,
        alt: img.alt || "Image without alt text"
      };
    }).filter(imgData => imgData.src); // Clean out empty sources

    // Fallback text if the container had text
    const parentText = target.innerText?.trim();
    if (parentText) extractedData.text = parentText;
  }

  // PDF Detection
  const pdfSelector = 'embed[type*="pdf"], iframe[src*=".pdf"], object[type*="pdf"], iframe[type="application/pdf"]';
  let pdfElement = target.matches(pdfSelector) ? target : target.querySelector(pdfSelector);
  const pdfTemplate = document.querySelector('template[shadowrootmode]');

  if (!pdfElement && !pdfTemplate) {
    // Check if the current target is an anchor pointing to a PDF
    if (target.tagName && target.tagName.toLowerCase() === 'a' && target.href?.toLowerCase().endsWith('.pdf')) {
      pdfElement = target;
    }
  }

  if (pdfElement || pdfTemplate) {
    let pdfUrl = pdfElement ? (pdfElement.getAttribute('original-url') || pdfElement.src || pdfElement.data || pdfElement.href) : window.location.href;
    if (pdfUrl === 'about:blank') pdfUrl = window.location.href;

    if (pdfUrl) {
      extractedData.pdfUrl = pdfUrl;
      extractedData.pdfName = pdfUrl.split('/').pop().split('?')[0] || 'document.pdf';
      extractedData.tag = 'PDF';
    }
  }

  if (!extractedData.text && imgTargets.length === 0 && !extractedData.pdfUrl) {
    console.log("we have a text element", target);
    /**
     * What: Attempt to find meaningful text in target or climbing up to immediate parents.
     * Why: Often users might click an SVG, an icon, or an empty wrapper div. We climb up
     *      to find the nearest root node with text so the context is still useful for the AI.
     */
    let textContent = target.innerText || target.textContent || "";
    textContent = textContent.trim();

    let attemptParent = target;
    let maxClimbs = 5;
    while (!textContent && attemptParent.parentElement && maxClimbs > 0) {
      attemptParent = attemptParent.parentElement;
      let fallbackText = attemptParent.innerText || attemptParent.textContent || "";
      if (fallbackText.trim()) {
        target = attemptParent;
        textContent = fallbackText.trim();
        break;
      }
      maxClimbs--;
    }
    extractedData.text = textContent;
  }

  safeSendMessage({
    type: 'ELEMENT_SELECTED',
    data: extractedData
  });

  stopSelectionMode();
}
