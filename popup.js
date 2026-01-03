/**
 * Scholar Reference Exporter - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const settings = await chrome.storage.sync.get({
    maxReferences: 1000,
    minDelaySeconds: 3,
    maxDelaySeconds: 8,
    cooldownSeconds: 15,
    enableSemanticScholar: true,
    autoSort: true
  });
  
  // Apply settings to UI
  document.getElementById('maxReferences').value = settings.maxReferences;
  document.getElementById('minDelaySeconds').value = settings.minDelaySeconds;
  document.getElementById('maxDelaySeconds').value = settings.maxDelaySeconds;
  document.getElementById('cooldownSeconds').value = settings.cooldownSeconds;
  document.getElementById('enableSemanticScholar').checked = settings.enableSemanticScholar;
  document.getElementById('autoSort').checked = settings.autoSort;
  
  // Check if on Google Scholar
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnScholar = tab?.url?.includes('scholar.google');
  
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  
  if (isOnScholar) {
    statusIndicator.classList.remove('inactive');
    statusText.textContent = 'Active on Google Scholar';
  } else {
    statusIndicator.classList.add('inactive');
    statusText.textContent = 'Navigate to Google Scholar to use';
  }
  
  // Save button handler
  const saveBtn = document.getElementById('saveBtn');
  
  saveBtn.addEventListener('click', async () => {
    const newSettings = {
      maxReferences: parseInt(document.getElementById('maxReferences').value, 10),
      minDelaySeconds: parseInt(document.getElementById('minDelaySeconds').value, 10),
      maxDelaySeconds: parseInt(document.getElementById('maxDelaySeconds').value, 10),
      cooldownSeconds: parseInt(document.getElementById('cooldownSeconds').value, 10),
      enableSemanticScholar: document.getElementById('enableSemanticScholar').checked,
      autoSort: document.getElementById('autoSort').checked
    };
    
    // Validate
    if (newSettings.maxReferences < 10) newSettings.maxReferences = 10;
    if (newSettings.maxReferences > 5000) newSettings.maxReferences = 5000;
    if (newSettings.minDelaySeconds < 1) newSettings.minDelaySeconds = 1;
    if (newSettings.maxDelaySeconds < newSettings.minDelaySeconds) {
      newSettings.maxDelaySeconds = newSettings.minDelaySeconds;
    }
    if (newSettings.cooldownSeconds < 15) newSettings.cooldownSeconds = 15;
    
    // Save
    await chrome.storage.sync.set(newSettings);
    
    // Update UI to reflect saved value
    document.getElementById('maxReferences').value = newSettings.maxReferences;
    document.getElementById('minDelaySeconds').value = newSettings.minDelaySeconds;
    document.getElementById('maxDelaySeconds').value = newSettings.maxDelaySeconds;
    document.getElementById('cooldownSeconds').value = newSettings.cooldownSeconds;
    
    // Show saved feedback
    saveBtn.textContent = '✓ Saved!';
    saveBtn.classList.add('saved');
    
    // Notify content script of settings change
    if (isOnScholar) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'settingsUpdated',
        settings: newSettings
      }).catch(() => {
        // Content script might not be ready, that's okay
      });
    }
    
    setTimeout(() => {
      saveBtn.textContent = 'Save Settings';
      saveBtn.classList.remove('saved');
    }, 2000);
  });
});
