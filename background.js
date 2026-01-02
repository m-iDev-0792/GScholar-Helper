/**
 * Scholar Reference Exporter - Background Service Worker
 * Handles downloads and cross-origin requests
 */

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message.url, message.filename)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
  
  if (message.action === 'fetch') {
    handleFetch(message.url, message.options)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Download a file
async function handleDownload(url, filename) {
  try {
    // Create download
    const downloadId = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
    
    console.log('[Scholar Reference Exporter] Download started:', downloadId);
    return downloadId;
  } catch (error) {
    console.error('[Scholar Reference Exporter] Download error:', error);
    throw error;
  }
}

// Fetch a URL (for cross-origin requests if needed)
async function handleFetch(url, options = {}) {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    
    return await response.text();
  } catch (error) {
    console.error('[Scholar Reference Exporter] Fetch error:', error);
    throw error;
  }
}

// Install event
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Scholar Reference Exporter] Extension installed');
    
    // Set default settings
    chrome.storage.sync.set({
      maxReferences: 1000,
      enableSemanticScholar: true,
      autoSort: true
    });
  } else if (details.reason === 'update') {
    console.log('[Scholar Reference Exporter] Extension updated to version', chrome.runtime.getManifest().version);
  }
});

// Keep service worker alive during long operations
let keepAliveInterval = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepAlive') {
    keepAliveInterval = setInterval(() => {
      port.postMessage({ type: 'ping' });
    }, 25000);
    
    port.onDisconnect.addListener(() => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    });
  }
});
