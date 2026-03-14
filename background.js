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
 * Handles START_SELECTION and STOP_SELECTION flow.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SELECTION') {
    const targetTabId = message.tabId;

    /**
     * Sends selection command to content script, injecting it if necessary.
     */
    const sendSelectionMessage = (tabId) => {
      chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' }).catch(() => {
        console.log("Content script not found, injecting now...");
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          files: ['content.js']
        }).then(() => {
          chrome.scripting.insertCSS({
            target: { tabId: tabId, allFrames: true },
            files: ['content.css']
          }).then(() => {
            chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' }).catch(err => console.error("Still failed to connect:", err));
          });
        }).catch(err => console.error("Failed to inject script: ", err));
      });
    };

    if (targetTabId) {
      sendSelectionMessage(targetTabId);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          sendSelectionMessage(tabs[0].id);
        }
      });
    }
  } else if (message.type === 'STOP_SELECTION') {
    if (message.tabId) {
      chrome.tabs.sendMessage(message.tabId, { type: 'STOP_SELECTION' }).catch(() => {});
    }
  }
});
