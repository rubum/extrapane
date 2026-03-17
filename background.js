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
  const tabId = message.tabId || (sender.tab ? sender.tab.id : null);

  const handleMessage = async () => {
    if (message.type === 'START_SELECTION') {
      const activeTabId = tabId || (await getActiveTabId());
      if (activeTabId) {
        await ensureContentScript(activeTabId);
        chrome.tabs.sendMessage(activeTabId, { type: 'START_SELECTION' }).catch(err => console.error("Start failed:", err));
      }
    } else if (message.type === 'STOP_SELECTION') {
      const activeTabId = tabId || (await getActiveTabId());
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { type: 'STOP_SELECTION' }).catch(() => {});
      }
    } else if (message.type === 'GET_PAGE_PDFS') {
      const activeTabId = tabId || (await getActiveTabId());
      if (activeTabId) {
        await ensureContentScript(activeTabId);
        chrome.tabs.sendMessage(activeTabId, { type: 'GET_PAGE_PDFS' }, (response) => {
          sendResponse(response);
        });
        return true; // Keep channel open for async sendResponse
      }
    }
  };

  handleMessage();
  if (message.type === 'GET_PAGE_PDFS') return true; 
});

/**
 * Ensures content.js is injected into the target tab.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch (err) {
    console.log("Content script not found, injecting now...");
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tabId, allFrames: true },
      files: ['content.css']
    });
  }
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}
