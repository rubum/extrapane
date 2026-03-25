/**
 * background.js
 * Service worker responsible for managing the side panel behavior
 * and relaying selection messages between the side panel and content scripts.
 */

// Configure side panel to open on toolbar icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

/**
 * Global message listener for extension-wide communication.
 * Handles START_SELECTION, STOP_SELECTION and GET_PAGE_PDFS flows.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_REMOTE_VIDEO') {
    fetchRemoteVideo(message.url).then(sendResponse).catch(err => {
      console.error("Background fetch failed:", err);
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }
});

async function fetchRemoteVideo(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  return { base64, type: blob.type };
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
