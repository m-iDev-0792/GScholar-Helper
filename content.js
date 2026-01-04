/**
 * Scholar Reference Exporter - Content Script
 * Handles Google Scholar page interaction and reference extraction
 */

(function() {
  'use strict';

  // Configuration
  const BASE_CONFIG = {
    semanticScholarBatchSize: 10,
    semanticScholarDelay: 200,
    similarityThreshold: 0.6,
    captchaCheckInterval: 2000,
    captchaTimeout: 300000, // 5 minutes max wait for captcha
    cooldownPages: 5,
    resultsPerPage: 20,
    backoffScheduleMs: [10000, 30000],
    backoffLongDelayRangeMs: { min: 120000, max: 300000 },
    maxAutoRetries: 3
  };

  const DEFAULT_SETTINGS = {
    maxReferences: 1000,
    minDelaySeconds: 3,
    maxDelaySeconds: 8,
    cooldownSeconds: 15,
    yearRetryAttempts: 0,
    enableSemanticScholar: true,
    semanticScholarApiKey: '',
    autoSort: true,
    exportDebugData: false
  };

  let CONFIG = { ...BASE_CONFIG, ...DEFAULT_SETTINGS };
  const settingsReady = loadSettings();

  // State management
  let currentExportTask = null;
  let isExporting = false;
  let captchaWindow = null;
  let retryCounter = 0;
  let debugInfo = {
    failedResponses: [],
    hasFailures: false
  };

  // ==================== Settings Management ====================

  function normalizeSettings() {
    if (CONFIG.minDelaySeconds < 1) CONFIG.minDelaySeconds = 1;
    if (CONFIG.maxDelaySeconds < CONFIG.minDelaySeconds) {
      CONFIG.maxDelaySeconds = CONFIG.minDelaySeconds;
    }
    if (!CONFIG.cooldownPages || CONFIG.cooldownPages < 1) {
      CONFIG.cooldownPages = BASE_CONFIG.cooldownPages;
    }
    
    CONFIG.minDelayMs = CONFIG.minDelaySeconds * 1000;
    CONFIG.maxDelayMs = CONFIG.maxDelaySeconds * 1000;
    CONFIG.cooldownMs = CONFIG.cooldownSeconds * 1000;
  }

  async function loadSettings() {
    try {
      const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      CONFIG = { ...BASE_CONFIG, ...DEFAULT_SETTINGS, ...saved };
      normalizeSettings();
    } catch (e) {
      logError('Failed to load settings, using defaults', e);
      CONFIG = { ...BASE_CONFIG, ...DEFAULT_SETTINGS };
      normalizeSettings();
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'settingsUpdated' && message.settings) {
      CONFIG = { ...CONFIG, ...message.settings };
      normalizeSettings();
    }
  });

  // ==================== UI Components ====================

  // Create the button container for a paper entry
  function createButtonContainer() {
    const container = document.createElement('div');
    container.className = 'sre-button-container';
    return container;
  }

  // Create the export button
  function createExportButton(paperEntry) {
    const button = document.createElement('button');
    button.className = 'sre-export-btn';
    button.textContent = 'Export All References';
    button.title = 'Export all citing papers to CSV';
    
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleExportClick(paperEntry, button);
    });
    
    return button;
  }

  // Create progress modal
  function createProgressModal() {
    const overlay = document.createElement('div');
    overlay.className = 'sre-modal-overlay';
    overlay.id = 'sre-progress-modal';
    
    overlay.innerHTML = `
      <div class="sre-modal sre-modal-progress">
        <div class="sre-modal-header">
          <h3>Exporting References</h3>
          <button class="sre-modal-close" id="sre-cancel-btn">✕</button>
        </div>
        <div class="sre-modal-body">
          <div class="sre-progress-info">
            <span id="sre-progress-text">Initializing...</span>
          </div>
          <div class="sre-progress-bar-container">
            <div class="sre-progress-bar" id="sre-progress-bar"></div>
          </div>
          <div class="sre-progress-pages" id="sre-progress-pages"></div>
          <div class="sre-progress-retries" id="sre-progress-retries"></div>
          <div class="sre-progress-details">
            <span id="sre-progress-details"></span>
          </div>
          <div class="sre-progress-stage" id="sre-progress-stage"></div>
          <div class="sre-debug-log-container">
            <div class="sre-debug-log-header">Debug Log</div>
            <div class="sre-debug-log" id="sre-debug-log"></div>
          </div>
        </div>
        <div class="sre-modal-footer">
          <button class="sre-btn sre-btn-secondary" id="sre-stop-export-btn">Stop & Export Now</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Setup cancel handlers
    const cancelBtn = document.getElementById('sre-cancel-btn');
    const stopExportBtn = document.getElementById('sre-stop-export-btn');

    const handleCancel = () => {
      if (currentExportTask) {
        currentExportTask.cancelled = true;
      }
      closeProgressModal();
    };

    cancelBtn.addEventListener('click', handleCancel);
    stopExportBtn.addEventListener('click', () => {
      if (currentExportTask) {
        currentExportTask.stopRequested = true;
      }
      stopExportBtn.disabled = true;
      stopExportBtn.textContent = 'Stopping...';
    });

    return overlay;
  }

  // Update progress modal
  function updateProgress(text, percent, details = '', stage = '', pageInfo = '', retryInfo = '') {
    const progressText = document.getElementById('sre-progress-text');
    const progressBar = document.getElementById('sre-progress-bar');
    const progressDetails = document.getElementById('sre-progress-details');
    const progressStage = document.getElementById('sre-progress-stage');
    const progressPages = document.getElementById('sre-progress-pages');
    const progressRetries = document.getElementById('sre-progress-retries');

    if (progressText) progressText.textContent = text;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressDetails) progressDetails.textContent = details;
    if (progressStage) progressStage.textContent = stage;
    if (progressPages) progressPages.textContent = pageInfo;
    if (progressRetries) progressRetries.textContent = retryInfo;
  }

  // Add debug log message to progress modal
  function addDebugLog(message, type = 'info') {
    const debugLog = document.getElementById('sre-debug-log');
    if (!debugLog) return;

    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `sre-log-entry sre-log-${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;

    debugLog.appendChild(logEntry);
    // Auto-scroll to bottom
    debugLog.scrollTop = debugLog.scrollHeight;
  }

  // Clear debug log
  function clearDebugLog() {
    const debugLog = document.getElementById('sre-debug-log');
    if (debugLog) {
      debugLog.innerHTML = '';
    }
  }

  // Close progress modal
  function closeProgressModal() {
    const modal = document.getElementById('sre-progress-modal');
    if (modal) {
      modal.remove();
    }
    isExporting = false;
    currentExportTask = null;
  }

  // Get debug log HTML content
  function getDebugLogContent() {
    const debugLog = document.getElementById('sre-debug-log');
    return debugLog ? debugLog.innerHTML : '';
  }

  // Show completion modal
  function showCompletionModal(count, filename) {
    // Capture debug log before closing progress modal
    const debugLogContent = getDebugLogContent();

    closeProgressModal();

    const overlay = document.createElement('div');
    overlay.className = 'sre-modal-overlay';
    overlay.id = 'sre-completion-modal';

    overlay.innerHTML = `
      <div class="sre-modal sre-modal-success sre-modal-wide">
        <div class="sre-modal-header">
          <h3>✓ Export Complete</h3>
          <button class="sre-modal-close" id="sre-close-completion">✕</button>
        </div>
        <div class="sre-modal-body">
          <p>Successfully exported <strong>${count}</strong> references.</p>
          <p class="sre-filename">File: ${filename}</p>
          ${debugLogContent ? `
            <div class="sre-debug-log-container" style="margin-top: 16px;">
              <div class="sre-debug-log-header">Extraction Log</div>
              <div class="sre-debug-log">${debugLogContent}</div>
            </div>
          ` : ''}
        </div>
        <div class="sre-modal-footer">
          <button class="sre-btn sre-btn-primary" id="sre-close-completion-btn">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = document.getElementById('sre-close-completion');
    const closeCompletionBtn = document.getElementById('sre-close-completion-btn');

    const handleClose = () => overlay.remove();

    closeBtn.addEventListener('click', handleClose);
    closeCompletionBtn.addEventListener('click', handleClose);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleClose();
    });
  }

  // Show error modal
  function showErrorModal(message) {
    closeProgressModal();

    const overlay = document.createElement('div');
    overlay.className = 'sre-modal-overlay';
    overlay.id = 'sre-error-modal';

    // Show debug button only if debug export is enabled AND there are failures
    const showDebugButton = CONFIG.exportDebugData && debugInfo.hasFailures;
    const debugButtonHtml = showDebugButton
      ? `<button class="sre-btn sre-btn-debug" id="sre-error-debug-btn">Export Debug Data (${debugInfo.failedResponses.length} failures)</button>`
      : '';

    overlay.innerHTML = `
      <div class="sre-modal sre-modal-error">
        <div class="sre-modal-header">
          <h3>✕ Export Failed</h3>
          <button class="sre-modal-close" id="sre-close-error">✕</button>
        </div>
        <div class="sre-modal-body">
          <p>${message}</p>
          ${showDebugButton ? '<p style="margin-top: 12px; font-size: 13px; color: #f59e0b;">Debug data is available. Click the button below to export the failed responses for analysis.</p>' : ''}
        </div>
        <div class="sre-modal-footer">
          ${debugButtonHtml}
          <button class="sre-btn sre-btn-primary" id="sre-close-error-btn">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = document.getElementById('sre-close-error');
    const closeErrorBtn = document.getElementById('sre-close-error-btn');
    const debugBtn = document.getElementById('sre-error-debug-btn');

    const handleClose = () => overlay.remove();

    closeBtn.addEventListener('click', handleClose);
    closeErrorBtn.addEventListener('click', handleClose);

    if (debugBtn) {
      debugBtn.addEventListener('click', () => {
        downloadDebugData();
      });
    }
  }

  // ==================== CAPTCHA Handling ====================

  // Check if HTML contains CAPTCHA indicators
  function isCaptchaPage(html) {
    const captchaIndicators = [
      'gs_captcha',
      'recaptcha',
      'g-recaptcha',
      '/sorry/index',
      'unusual traffic',
      'automated requests',
      'please show you\'re not a robot',
      'verify you are a human',
      'sorry, we can\'t verify'
    ];
    
    const lowerHtml = html.toLowerCase();
    return captchaIndicators.some(indicator => lowerHtml.includes(indicator));
  }

  // Show CAPTCHA modal to user
  function showCaptchaModal(captchaUrl) {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'sre-modal-overlay';
      overlay.id = 'sre-captcha-modal';
      
      overlay.innerHTML = `
        <div class="sre-modal sre-modal-captcha">
          <div class="sre-modal-header sre-modal-header-warning">
            <h3>⚠️ Verification Required</h3>
          </div>
          <div class="sre-modal-body">
            <p><strong>Google Scholar is asking for verification.</strong></p>
            <p>A new tab will open where you can complete the CAPTCHA. After solving it, click "I've Completed Verification" to continue.</p>
            <div class="sre-captcha-instructions">
              <ol>
                <li>Click "Open Verification" below</li>
                <li>Complete the CAPTCHA in the new tab</li>
                <li>Return here and click "I've Completed Verification"</li>
              </ol>
            </div>
            <div class="sre-captcha-status" id="sre-captcha-status">
              Status: Waiting for verification...
            </div>
          </div>
          <div class="sre-modal-footer sre-modal-footer-captcha">
            <button class="sre-btn sre-btn-primary" id="sre-open-captcha-btn">
              🔗 Open Verification
            </button>
            <button class="sre-btn sre-btn-success" id="sre-captcha-done-btn" disabled>
              ✓ I've Completed
            </button>
            <button class="sre-btn sre-btn-secondary" id="sre-captcha-cancel-btn">
              Cancel
            </button>
          </div>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      const openBtn = document.getElementById('sre-open-captcha-btn');
      const doneBtn = document.getElementById('sre-captcha-done-btn');
      const cancelBtn = document.getElementById('sre-captcha-cancel-btn');
      const statusEl = document.getElementById('sre-captcha-status');
      
      let captchaTabOpened = false;
      
      openBtn.addEventListener('click', () => {
        // Open CAPTCHA page in new tab
        captchaWindow = window.open(captchaUrl, '_blank');
        captchaTabOpened = true;
        doneBtn.disabled = false;
        openBtn.textContent = '🔗 Reopen Verification Page';
        statusEl.textContent = 'Status: Verification page opened. Please complete the CAPTCHA.';
        statusEl.style.color = '#f59e0b';
      });
      
      doneBtn.addEventListener('click', async () => {
        statusEl.textContent = 'Status: Verifying...';
        statusEl.style.color = '#3b82f6';
        doneBtn.disabled = true;
        
        // Test if CAPTCHA was solved by trying to fetch Scholar
        try {
          const testResponse = await fetch('https://scholar.google.com/scholar?q=test', {
            credentials: 'include'
          });
          const testHtml = await testResponse.text();
          
          if (isCaptchaPage(testHtml)) {
            statusEl.textContent = 'Status: Verification not complete. Please try again.';
            statusEl.style.color = '#ef4444';
            doneBtn.disabled = false;
          } else {
            statusEl.textContent = 'Status: ✓ Verified successfully!';
            statusEl.style.color = '#22c55e';
            
            // Close captcha tab if still open
            if (captchaWindow && !captchaWindow.closed) {
              captchaWindow.close();
            }
            
            setTimeout(() => {
              overlay.remove();
              resolve(true);
            }, 1000);
          }
        } catch (e) {
          statusEl.textContent = 'Status: Error checking verification. Please try again.';
          statusEl.style.color = '#ef4444';
          doneBtn.disabled = false;
        }
      });
      
      cancelBtn.addEventListener('click', () => {
        if (captchaWindow && !captchaWindow.closed) {
          captchaWindow.close();
        }
        overlay.remove();
        reject(new Error('User cancelled CAPTCHA verification'));
      });
      
      // Set timeout
      setTimeout(() => {
        if (document.getElementById('sre-captcha-modal')) {
          overlay.remove();
          reject(new Error('CAPTCHA verification timed out'));
        }
      }, CONFIG.captchaTimeout);
    });
  }

  // Handle CAPTCHA when detected
  async function handleCaptcha(url) {
    log('CAPTCHA detected, prompting user...');
    
    updateProgress(
      'Verification required',
      0,
      'Please complete the CAPTCHA to continue',
      'Waiting for verification...'
    );
    
    // Hide the progress modal temporarily
    const progressModal = document.getElementById('sre-progress-modal');
    if (progressModal) {
      progressModal.style.display = 'none';
    }
    
    try {
      await showCaptchaModal(url);
      log('CAPTCHA solved, resuming...');
      
      // Show progress modal again
      if (progressModal) {
        progressModal.style.display = 'flex';
      }
      
      return true;
    } catch (e) {
      logError('CAPTCHA handling failed:', e);
      throw e;
    }
  }

  // ==================== Scholar Parsing ====================

  // Find the "Cited by N" link in a paper entry
  // Extract cited-by link and count
  function findCitedByLink(paperEntry) {
    const links = paperEntry.querySelectorAll('.gs_fl a, .gs_fl2 a');
    for (const link of links) {
      const text = link.textContent.trim();
      const lowerText = text.toLowerCase();
      if (lowerText.match(/^cited by \d+/) || lowerText.includes('被引用')) {
        const countMatch = text.match(/(\d+)/);
        return {
          href: link.href,
          count: countMatch ? parseInt(countMatch[1], 10) : null
        };
      }
    }
    return null;
  }

  // Get paper title from entry
  function getPaperTitle(paperEntry) {
    const titleEl = paperEntry.querySelector('.gs_rt a, .gs_rt');
    if (titleEl) {
      // Remove any nested elements like [PDF], [HTML] badges
      const clone = titleEl.cloneNode(true);
      const badges = clone.querySelectorAll('.gs_ctc, .gs_ct1, .gs_ct2');
      badges.forEach(b => b.remove());
      return clone.textContent.trim();
    }
    return 'Unknown Paper';
  }

  // Parse a single citation entry from Scholar HTML
  function parseCitationEntry(entryEl) {
    const result = {
      title: '',
      authors: '',
      venue: '',
      year: null,
      pdfUrl: '',
      abstract: '',
      scholarUrl: '',
      scholarId: '',
      rawMeta: ''
    };
    
    // Scholar result id is the most reliable dedupe key
    const cid = entryEl.getAttribute('data-cid');
    if (cid) {
      result.scholarId = cid;
    }
    
    // Title
    const titleEl = entryEl.querySelector('.gs_rt a');
    if (titleEl) {
      result.title = titleEl.textContent.trim();
      result.scholarUrl = titleEl.href;
    } else {
      const titleContainer = entryEl.querySelector('.gs_rt');
      if (titleContainer) {
        result.title = titleContainer.textContent.trim();
      }
    }
    
    // Meta line (authors, venue, year)
    const metaEl = entryEl.querySelector('.gs_a');
    if (metaEl) {
      result.rawMeta = metaEl.textContent.trim();
      result.authors = parseAuthorsFromMeta(result.rawMeta);
      result.venue = parseVenueFromMeta(result.rawMeta);
      result.year = extractYear(result.rawMeta);
    }
    
    // Abstract/snippet
    const snippetEl = entryEl.querySelector('.gs_rs');
    if (snippetEl) {
      result.abstract = snippetEl.textContent.trim();
    }
    
    // PDF link
    const pdfLinks = entryEl.querySelectorAll('.gs_or_ggsm a, .gs_ggs a');
    for (const link of pdfLinks) {
      const href = link.href;
      if (href && (href.includes('.pdf') || link.textContent.includes('[PDF]'))) {
        result.pdfUrl = href;
        break;
      }
    }
    
    // Also check sidebar links
    if (!result.pdfUrl) {
      const sideLinks = entryEl.querySelectorAll('a');
      for (const link of sideLinks) {
        if (link.href && link.href.includes('.pdf')) {
          result.pdfUrl = link.href;
          break;
        }
      }
    }
    
    return result;
  }

  // Parse all citations from a Scholar page
  function parseCitationsFromPage(doc) {
    const citations = [];
    const entries = doc.querySelectorAll('.gs_r.gs_or.gs_scl, .gs_ri');
    
    // Fallback selector for different Scholar layouts
    const allEntries = entries.length > 0 ? entries : doc.querySelectorAll('[data-cid]');
    
    for (const entry of allEntries) {
      try {
        const citation = parseCitationEntry(entry);
        if (citation.title) {
          citations.push(citation);
        }
      } catch (e) {
        logError('Error parsing citation entry:', e);
      }
    }
    
    return citations;
  }

  // Normalize Scholar URL to a stable form for deduping
  function normalizeScholarUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      // Drop volatile params that can change per request
      ['oi', 'q', 'hl', 'as_ylo', 'as_yhi', 'scioq', 'cites', 'scipsc'].forEach(p => u.searchParams.delete(p));
      return `${u.origin}${u.pathname}${u.searchParams.toString() ? `?${u.searchParams.toString()}` : ''}`;
    } catch (e) {
      return url;
    }
  }

  // Generate keys used to detect duplicate citations
  function buildDedupKeys(citation) {
    const keys = [];
    
    if (citation.scholarId) {
      keys.push(`id:${citation.scholarId}`);
    }
    
    const normUrl = normalizeScholarUrl(citation.scholarUrl);
    if (normUrl) {
      keys.push(`url:${normUrl}`);
    }
    
    if (citation.title) {
      const titleKey = normalizeTitle(citation.title);
      const yearKey = citation.year ? `|${citation.year}` : '';
      if (titleKey) {
        keys.push(`title:${titleKey}${yearKey}`);
      }
    }
    
    return keys;
  }

  // Find the next page link
  function findNextPageLink(doc) {
    // Look for "Next" button
    const navButtons = doc.querySelectorAll('.gs_ico_nav_next');
    for (const btn of navButtons) {
      const parent = btn.closest('a');
      if (parent && parent.href) {
        return parent.href;
      }
    }
    
    // Alternative: look for numbered pagination links
    const pageLinks = doc.querySelectorAll('#gs_n a, .gs_nma');
    let currentFound = false;
    for (const link of pageLinks) {
      if (currentFound && link.href) {
        return link.href;
      }
      // Current page is usually a <b> or has different styling
      if (link.querySelector('b') || link.classList.contains('gs_nma')) {
        currentFound = true;
      }
    }
    
    return null;
  }

  // ==================== Data Fetching ====================

  function buildScholarUrl(baseUrl, params = {}) {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      url.searchParams.set(key, value);
    });

    // Force 20 results per page
    url.searchParams.set('num', CONFIG.resultsPerPage);
    // Note: Do NOT set scisbd=1, as that filters to only recent articles
    // The extension handles year filtering with as_ylo/as_yhi parameters

    return url.toString();
  }

  function getBackoffDelayMs(failureIndex) {
    if (failureIndex < CONFIG.backoffScheduleMs.length) {
      return CONFIG.backoffScheduleMs[failureIndex];
    }
    const range = CONFIG.backoffLongDelayRangeMs;
    const min = Math.max(range.min, 0);
    const max = Math.max(range.max, min);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function formatDelaySeconds(ms) {
    return Math.round(ms / 1000);
  }

  function computePageDelayMs(pageFetchCount) {
    const randomDelay = Math.floor(Math.random() * (CONFIG.maxDelayMs - CONFIG.minDelayMs + 1)) + CONFIG.minDelayMs;
    if (pageFetchCount > 0 && pageFetchCount % CONFIG.cooldownPages === 0) {
      return Math.max(CONFIG.cooldownMs, randomDelay);
    }
    return randomDelay;
  }

  async function waitBetweenPages(pageFetchCount) {
    const delayMs = computePageDelayMs(pageFetchCount);
    await sleep(delayMs);
    return delayMs;
  }

  async function fetchScholarPage(url, task, progressContext = {}) {
    let failureCount = 0;
    while (!task.cancelled) {
      try {
        const response = await fetch(url, {
          credentials: 'include',
          headers: {
            'Accept': 'text/html'
          }
        });

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error('Rate limited (HTTP 429)');
          }
          throw new Error(`Failed to fetch page: ${response.status}`);
        }

        const html = await response.text();
        if (isCaptchaPage(html)) {
          await handleCaptcha(url);
          throw new Error('CAPTCHA detected');
        }

        retryCounter = 0;
        return html;
      } catch (e) {
        failureCount++;
        retryCounter = failureCount;

        if (task.cancelled) {
          throw e;
        }

        let continueRetry = true;
        if (failureCount >= CONFIG.maxAutoRetries) {
          continueRetry = window.confirm(`Attempt ${failureCount} failed: ${e.message}. Continue retrying?`);
        }
        if (!continueRetry) {
          throw e;
        }

        const delayMs = getBackoffDelayMs(failureCount - 1);
        const retryInfo = `Retries: ${failureCount} (waiting ${formatDelaySeconds(delayMs)}s)`;
        updateProgress(
          progressContext.text || 'Retrying request...',
          progressContext.percent || 0,
          progressContext.details || e.message || 'Request failed',
          progressContext.stage || 'Retrying',
          progressContext.pageInfo || '',
          retryInfo
        );

        await sleep(delayMs);
      }
    }

    throw new Error('Export cancelled');
  }

  function addCitationsWithDedup(citations, seenCitationKeys, targetList, targetTotal) {
    let added = 0;
    for (const citation of citations) {
      const keys = buildDedupKeys(citation);
      const matchingKey = keys.find(key => seenCitationKeys.has(key));

      if (matchingKey) {
        // Log the duplicate with details
        const title = citation.title || 'Unknown Title';
        const year = citation.year ? ` (${citation.year})` : '';
        let reason = '';

        if (matchingKey.startsWith('id:')) {
          reason = 'Scholar ID';
        } else if (matchingKey.startsWith('url:')) {
          reason = 'URL';
        } else if (matchingKey.startsWith('title:')) {
          reason = 'Title+Year';
        }

        addDebugLog(`  ✕ Duplicate: "${title}"${year} - Reason: ${reason}`, 'warn');
        continue;
      }

      keys.forEach(key => seenCitationKeys.add(key));
      targetList.push(citation);
      added++;
      if (targetList.length >= targetTotal) break;
    }
    return added;
  }

  function deriveYearBounds(citations) {
    const years = citations
      .map(c => c.year)
      .filter(y => typeof y === 'number' && !Number.isNaN(y));
    if (years.length === 0) {
      const now = new Date().getFullYear();
      return { minYear: now - 1, maxYear: now };
    }
    return {
      minYear: Math.min(...years),
      maxYear: Math.max(...years)
    };
  }

  function getPaperYearFromEntry(paperEntry) {
    const metaEl = paperEntry.querySelector('.gs_a');
    if (!metaEl) return null;
    return extractYear(metaEl.textContent);
  }

  // Fetch all citations from Google Scholar (year by year, paginated)
  async function fetchAllCitations(citedByUrl, task, expectedTotal, paperYear) {
    const allCitations = [];
    const seenCitationKeys = new Set();
    const targetTotal = expectedTotal ? Math.min(expectedTotal, CONFIG.maxReferences) : CONFIG.maxReferences;
    const totalPagesEstimate = expectedTotal ? Math.max(1, Math.ceil(expectedTotal / CONFIG.resultsPerPage)) : null;
    const pageState = { count: 0 };

    // Determine correct year bounds
    const currentYear = new Date().getFullYear();
    const yearStopLimit = paperYear || 1900;
    const maxYear = currentYear;
    const minYear = yearStopLimit;

    addDebugLog(`Year range: ${minYear} (paper year) to ${maxYear} (current year)`);
    addDebugLog(`Starting year-by-year extraction from ${maxYear} down to ${minYear}`);

    // Start from current year and go backwards to paper year
    let processingYear = maxYear;
    let oldestYearSeen = maxYear;
    let consecutiveEmptyYears = 0;

    const totalYears = maxYear - minYear + 1;
    let yearsProcessed = 0;

    while (!task.cancelled && !task.stopRequested && allCitations.length < targetTotal && processingYear >= yearStopLimit) {
      yearsProcessed++;
      const { yearHadResults } = await fetchCitationsForYear({
        year: processingYear,
        baseUrl: citedByUrl,
        task,
        targetTotal,
        seenCitationKeys,
        allCitations,
        totalYears,
        yearsProcessed,
        pageState
      });

      if (!yearHadResults) {
        consecutiveEmptyYears++;
        if (consecutiveEmptyYears >= 3 && processingYear < oldestYearSeen - 1) {
          log(`No results for ${consecutiveEmptyYears} consecutive years; stopping early at year ${processingYear}`);
          const currentProgress = Math.min(35, (yearsProcessed / totalYears) * 35);
          updateProgress(
            `Stopping early - ${consecutiveEmptyYears} consecutive empty years`,
            currentProgress,
            `Collected ${allCitations.length} unique references total`,
            'Stage 1/3: Collecting from Google Scholar',
            `Year ${yearsProcessed}/${totalYears} (stopped at ${processingYear})`,
            ''
          );
          break;
        }
      } else {
        oldestYearSeen = Math.min(oldestYearSeen, processingYear);
        consecutiveEmptyYears = 0;
      }

      if (allCitations.length >= targetTotal) {
        break;
      }

      processingYear--;

      if (!task.stopRequested && processingYear >= yearStopLimit) {
        await waitBetweenPages(pageState.count);
      }
    }

    addDebugLog(`Finished collecting from Google Scholar: ${allCitations.length} unique citations`, 'success');

    return allCitations;
  }

  async function fetchCitationsForYear({
    year,
    baseUrl,
    task,
    targetTotal,
    seenCitationKeys,
    allCitations,
    totalYears,
    yearsProcessed,
    pageState
  }) {
    let start = 0;
    let pageInYear = 0;
    let added = 0;
    let hasMore = true;
    let yearHadResults = false;
    let pageRetryCount = 0;

    while (!task.cancelled && !task.stopRequested && hasMore && allCitations.length < targetTotal) {
      pageInYear++;
      pageState.count++;
      const pageLabel = `Year ${year} • Page ${pageInYear}`;
      const progressPercent = Math.min(35, (yearsProcessed / totalYears) * 35);
      const yearProgress = `Year ${yearsProcessed}/${totalYears} (${year})`;

      updateProgress(
        `Fetching ${pageLabel}...`,
        progressPercent,
        `Collected ${allCitations.length} unique references`,
        'Stage 1/3: Collecting from Google Scholar',
        yearProgress,
        retryCounter ? `Retries: ${retryCounter}` : ''
      );

      const pageUrl = buildScholarUrl(baseUrl, { start, as_ylo: year, as_yhi: year });
      const html = await fetchScholarPage(pageUrl, task, {
        text: `Retrying ${pageLabel}...`,
        percent: progressPercent,
        stage: 'Stage 1/3: Collecting from Google Scholar',
        pageInfo: pageLabel
      });

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const pageCitations = parseCitationsFromPage(doc);
      log(`Year ${year} page ${pageInYear}: found ${pageCitations.length} citations`);

      if (pageCitations.length > CONFIG.resultsPerPage) {
        addDebugLog(`  Note: Google returned ${pageCitations.length} papers (requested ${CONFIG.resultsPerPage})`, 'warn');
      }

      if (pageCitations.length === 0) {
        // Capture failed response for debugging (only if enabled)
        if (CONFIG.exportDebugData) {
          const reason = pageInYear === 1
            ? `No results for year on page ${pageInYear} (retry ${pageRetryCount}/${CONFIG.yearRetryAttempts})`
            : `No results on page ${pageInYear} (retry ${pageRetryCount}/${CONFIG.yearRetryAttempts})`;

          debugInfo.failedResponses.push({
            timestamp: new Date().toISOString(),
            year: year,
            page: pageInYear,
            retryAttempt: pageRetryCount,
            maxRetries: CONFIG.yearRetryAttempts,
            url: pageUrl,
            html: html,
            reason: reason
          });
          debugInfo.hasFailures = true;
        }

        // No papers found for this year/page - retry if attempts remaining
        if (pageRetryCount < CONFIG.yearRetryAttempts) {
          pageRetryCount++;
          const pageDesc = pageInYear === 1 ? `Year ${year}` : `Year ${year} page ${pageInYear}`;
          log(`${pageDesc}: No papers found, retrying (attempt ${pageRetryCount}/${CONFIG.yearRetryAttempts})`);
          addDebugLog(`${pageDesc}: No papers found, retrying (${pageRetryCount}/${CONFIG.yearRetryAttempts})`, 'warn');

          updateProgress(
            `${pageDesc}: Retrying after cooldown (${pageRetryCount}/${CONFIG.yearRetryAttempts})`,
            progressPercent,
            `Collected ${allCitations.length} unique references`,
            'Stage 1/3: Collecting from Google Scholar',
            yearProgress,
            `Retry ${pageRetryCount}/${CONFIG.yearRetryAttempts}`
          );

          // Wait cooldown before retry
          await sleep(CONFIG.cooldownMs);

          // Reset to retry the same page
          pageInYear--;
          pageState.count--;
          continue; // Retry the while loop
        } else {
          // Out of retries
          if (pageInYear === 1) {
            // First page failed - skip entire year
            log(`Year ${year}: No papers found after ${pageRetryCount} retries, skipping year`);
            addDebugLog(`Year ${year}: No papers found after ${pageRetryCount} retries, skipping year`, 'error');
            updateProgress(
              `Year ${year}: No papers found (${pageRetryCount} retries)`,
              progressPercent,
              `Collected ${allCitations.length} unique references (skipping year ${year})`,
              'Stage 1/3: Collecting from Google Scholar',
              yearProgress,
              retryCounter ? `Retries: ${retryCounter}` : ''
            );
            return { added, yearHadResults: false };
          } else {
            // Subsequent page failed - stop pagination for this year
            logError(`Year ${year} page ${pageInYear}: No papers returned after ${pageRetryCount} retries`);
            addDebugLog(`Year ${year} page ${pageInYear}: No papers after ${pageRetryCount} retries`, 'error');
            updateProgress(
              `Year ${year}: Page ${pageInYear} failed (${pageRetryCount} retries)`,
              progressPercent,
              `Collected ${allCitations.length} unique references so far`,
              'Stage 1/3: Collecting from Google Scholar',
              yearProgress,
              retryCounter ? `Retries: ${retryCounter}` : ''
            );
            // Stop pagination for this year but keep what we got
            return { added, yearHadResults };
          }
        }
      }

      // Successfully got results - reset retry counter for next page
      yearHadResults = true;
      pageRetryCount = 0;

      const beforeCount = allCitations.length;
      added += addCitationsWithDedup(pageCitations, seenCitationKeys, allCitations, targetTotal);
      const afterCount = allCitations.length;
      const duplicates = pageCitations.length - (afterCount - beforeCount);

      addDebugLog(`Year ${year} page ${pageInYear}: Found ${pageCitations.length} papers, added ${afterCount - beforeCount} (${duplicates} duplicates)`);
      if (duplicates > 0) {
        addDebugLog(`  Total unique citations so far: ${afterCount}`, 'info');
      }

      // Update progress with current citation count immediately after adding
      updateProgress(
        `Processing ${pageLabel}...`,
        progressPercent,
        `Collected ${afterCount} unique references`,
        'Stage 1/3: Collecting from Google Scholar',
        yearProgress,
        retryCounter ? `Retries: ${retryCounter}` : ''
      );

      if (allCitations.length >= targetTotal) {
        return { added, yearHadResults };
      }

      // Check if next page exists - don't rely on exact count as Scholar may return different amounts
      const nextPageLink = findNextPageLink(doc);
      const nextPageExists = !!nextPageLink;
      start += CONFIG.resultsPerPage;

      if (nextPageExists && !task.stopRequested) {
        addDebugLog(`  Next page available, continuing...`);
      } else if (!nextPageLink) {
        addDebugLog(`  No next page link found, year ${year} complete`);
      }

      if (nextPageExists && !task.stopRequested) {
        const delayMs = await waitBetweenPages(pageState.count);
        updateProgress(
          `Waiting ${formatDelaySeconds(delayMs)}s before next page...`,
          progressPercent,
          `Collected ${allCitations.length} unique references`,
          'Stage 1/3: Collecting from Google Scholar',
          yearProgress,
          retryCounter ? `Retries: ${retryCounter}` : ''
        );
      } else {
        hasMore = false;
      }
    }

    return { added, yearHadResults };
  }

  // ==================== Semantic Scholar API ====================

  // Search for a paper in Semantic Scholar
  async function searchSemanticScholar(title, year, retryCount = 0) {
    const query = encodeURIComponent(title);
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&limit=5&fields=paperId,title,year,authors,venue,abstract,openAccessPdf`;

    const headers = {};
    if (CONFIG.semanticScholarApiKey) {
      headers['x-api-key'] = CONFIG.semanticScholarApiKey;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited
          if (retryCount < 2) {
            // Retry up to 2 times with exponential backoff
            const waitTime = CONFIG.semanticScholarApiKey ? 2000 : (retryCount + 1) * 3000;
            addDebugLog(`  Rate limited, waiting ${waitTime}ms before retry ${retryCount + 1}/2`, 'warn');
            await sleep(waitTime);
            return await searchSemanticScholar(title, year, retryCount + 1);
          } else {
            addDebugLog(`  Rate limit: Max retries reached for "${title.substring(0, 40)}..."`, 'error');
            return null;
          }
        }
        return null;
      }
      return await response.json();
    } catch (e) {
      logError('Semantic Scholar API error:', e);
      return null;
    }
  }

  // Find best matching paper from Semantic Scholar results
  function findBestMatch(scholarCitation, ssResults) {
    if (!ssResults || !ssResults.data || ssResults.data.length === 0) {
      return null;
    }
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const paper of ssResults.data) {
      const titleSim = titleSimilarity(scholarCitation.title, paper.title);
      
      // Year matching bonus
      let yearScore = 0;
      if (scholarCitation.year && paper.year) {
        if (scholarCitation.year === paper.year) {
          yearScore = 0.2;
        } else if (Math.abs(scholarCitation.year - paper.year) <= 1) {
          yearScore = 0.1;
        }
      }
      
      const totalScore = titleSim + yearScore;
      
      if (totalScore > bestScore && titleSim >= CONFIG.similarityThreshold) {
        bestScore = totalScore;
        bestMatch = paper;
      }
    }
    
    return bestMatch;
  }

  // Enrich citations with Semantic Scholar data
  async function enrichWithSemanticScholar(citations, task) {
    const total = citations.length;
    let processed = 0;
    let matchedCount = 0;
    let abstractEnrichedCount = 0;
    let rateLimitCount = 0;

    // Determine API rate based on whether we have an API key
    const hasApiKey = CONFIG.semanticScholarApiKey && CONFIG.semanticScholarApiKey.length > 0;
    const apiDelay = hasApiKey ? 1000 : CONFIG.semanticScholarDelay; // 1 req/sec with key, 200ms without
    const apiStatus = hasApiKey
      ? 'With API key: 1 req/sec'
      : 'Without API key: 100 req/5min';

    addDebugLog(`Semantic Scholar API: ${apiStatus}`, 'info');

    for (const citation of citations) {
      if (task.cancelled) break;

      processed++;
      const rateInfo = hasApiKey
        ? `1 req/sec (${processed}/${total})`
        : `5 req/min (${processed}/${total})`;

      updateProgress(
        `Enriching metadata (${processed}/${total})...`,
        30 + Math.floor((processed / total) * 50),
        `Processing: ${citation.title.substring(0, 50)}...`,
        `Stage 2/3: Semantic Scholar - ${apiStatus}`,
        rateInfo,
        rateLimitCount > 0 ? `Rate limits: ${rateLimitCount}` : ''
      );
      
      try {
        const ssResults = await searchSemanticScholar(citation.title, citation.year);

        // Track if we hit rate limiting (indicated by null result after retries)
        if (ssResults === null) {
          rateLimitCount++;
        }

        const match = findBestMatch(citation, ssResults);
        
        if (match) {
          matchedCount++;
          // Update with better data from Semantic Scholar
          let enrichedFields = [];

          if (match.authors && match.authors.length > 0) {
            citation.authors = match.authors.map(a => a.name).join('; ');
            enrichedFields.push('authors');
          }
          if (match.venue) {
            citation.venue = match.venue;
            enrichedFields.push('venue');
          }
          if (match.year) {
            citation.year = match.year;
            enrichedFields.push('year');
          }
          if (match.abstract) {
            const hadAbstract = citation.abstract && citation.abstract.length > 0;
            const gsSnippetLength = citation.abstract ? citation.abstract.length : 0;
            const ssAbstractLength = match.abstract.length;

            // Always prefer Semantic Scholar abstract if available
            if (!hadAbstract || ssAbstractLength > gsSnippetLength) {
              citation.abstract = match.abstract;
              abstractEnrichedCount++;
              if (hadAbstract) {
                enrichedFields.push(`abstract (${gsSnippetLength}→${ssAbstractLength} chars)`);
              } else {
                enrichedFields.push(`abstract (${ssAbstractLength} chars)`);
              }
            }
          }
          if (match.openAccessPdf && match.openAccessPdf.url) {
            citation.pdfUrl = match.openAccessPdf.url;
            enrichedFields.push('PDF');
          }

          citation.semanticScholarId = match.paperId;

          if (enrichedFields.length > 0) {
            addDebugLog(`  ✓ Enriched "${citation.title.substring(0, 50)}...": ${enrichedFields.join(', ')}`, 'success');
          }
        }

        // Rate limiting for Semantic Scholar (use appropriate delay based on API key)
        await sleep(apiDelay);

      } catch (e) {
        logError('Error enriching citation:', e);
        // Continue with other citations
      }
    }

    // Log summary
    const rateLimitMsg = rateLimitCount > 0 ? `, ${rateLimitCount} rate-limited` : '';
    addDebugLog(`Semantic Scholar enrichment complete: ${matchedCount}/${total} papers matched, ${abstractEnrichedCount} abstracts enriched${rateLimitMsg}`, rateLimitCount > 0 ? 'warn' : 'success');

    return citations;
  }

  // ==================== Export Functions ====================

  // Sort citations by year (newest first)
  function sortByYear(citations) {
    return citations.sort((a, b) => {
      if (a.year === null && b.year === null) return 0;
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
  }

  // Generate and download CSV
  function downloadCSV(citations, paperTitle) {
    const columns = [
      { key: 'title', label: 'Title' },
      { key: 'authors', label: 'Authors' },
      { key: 'venue', label: 'Venue' },
      { key: 'year', label: 'Year' },
      { key: 'pdfUrl', label: 'PDF URL' },
      { key: 'abstract', label: 'Abstract' },
      { key: 'scholarUrl', label: 'Scholar URL' }
    ];
    
    const csvContent = toCSV(citations, columns);
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Filename format: PaperName_N_citations_YYYY-MM-DD.csv
    const citationCount = citations.length;
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${sanitizeFilename(paperTitle)}_${citationCount}_citations_${dateStr}.csv`;

    // Use downloads API via background script
    chrome.runtime.sendMessage({
      action: 'download',
      url: url,
      filename: filename
    }, (response) => {
      URL.revokeObjectURL(url);
    });
    
    return filename;
  }

  // Download debug data for failed requests
  function downloadDebugData() {
    if (!debugInfo.hasFailures || debugInfo.failedResponses.length === 0) {
      alert('No debug data available');
      return;
    }

    // Create debug report
    const debugReport = {
      exportTime: new Date().toISOString(),
      totalFailedRequests: debugInfo.failedResponses.length,
      failedRequests: debugInfo.failedResponses.map((failure, index) => ({
        index: index + 1,
        timestamp: failure.timestamp,
        year: failure.year,
        page: failure.page,
        url: failure.url,
        reason: failure.reason,
        htmlLength: failure.html.length,
        htmlPreview: failure.html.substring(0, 500) + '...'
      })),
      fullResponses: debugInfo.failedResponses.map((failure, index) => ({
        index: index + 1,
        timestamp: failure.timestamp,
        year: failure.year,
        page: failure.page,
        url: failure.url,
        reason: failure.reason,
        fullHTML: failure.html
      }))
    };

    // Create JSON blob
    const jsonContent = JSON.stringify(debugReport, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const filename = `scholar_debug_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    // Use downloads API via background script
    chrome.runtime.sendMessage({
      action: 'download',
      url: url,
      filename: filename
    }, (response) => {
      URL.revokeObjectURL(url);
      log(`Debug data exported: ${filename}`);
    });

    return filename;
  }

  // ==================== Main Export Handler ====================

  async function handleExportClick(paperEntry, button) {
    if (isExporting) {
      log('Export already in progress');
      return;
    }

    await settingsReady;
    await loadSettings();
    retryCounter = 0;
    const paperYear = getPaperYearFromEntry(paperEntry);
    
    // Find Cited by link
    const citedByInfo = findCitedByLink(paperEntry);
    if (!citedByInfo) {
      showErrorModal('Could not find "Cited by" link for this paper. The paper may have no citations.');
      return;
    }
    const citedByUrl = citedByInfo.href;
    const expectedTotal = citedByInfo.count || null;
    
    const paperTitle = getPaperTitle(paperEntry);
    log('Starting export for:', paperTitle);
    log('Cited by URL:', citedByUrl);
    if (expectedTotal) {
      log(`Expected citation count: ${expectedTotal}`);
    }
    
    isExporting = true;
    currentExportTask = { cancelled: false, stopRequested: false };

    // Reset debug info for new export
    debugInfo = {
      failedResponses: [],
      hasFailures: false
    };

    createProgressModal();

    try {
      // Add initial debug logs
      addDebugLog(`Starting export for: "${paperTitle}"`);
      if (expectedTotal) {
        addDebugLog(`Google Scholar reports ${expectedTotal} total citations`);
      }
      if (paperYear) {
        addDebugLog(`Paper published in ${paperYear}, will fetch citations from ${paperYear} onwards`);
      }
      addDebugLog(`Using delay: ${CONFIG.minDelaySeconds}-${CONFIG.maxDelaySeconds}s between pages`);

      // Stage 1: Fetch all citations from Google Scholar
      updateProgress(
        'Collecting citations from Google Scholar...',
        5,
        expectedTotal ? `Target: ${expectedTotal} citations` : '',
        'Stage 1/3: Collecting from Google Scholar',
        expectedTotal ? `Page 1/${Math.max(1, Math.ceil(expectedTotal / CONFIG.resultsPerPage))}` : ''
      );
      const citations = await fetchAllCitations(citedByUrl, currentExportTask, expectedTotal, paperYear);
      
      if (currentExportTask.cancelled) {
        log('Export cancelled by user');
        return;
      }
      
      if (citations.length === 0) {
        showErrorModal('No citations found. The paper may have no citations or there was an error fetching them.');
        return;
      }
      
      log(`Collected ${citations.length} citations from Google Scholar`);
      
      if (currentExportTask.stopRequested) {
        log('Stop requested by user; exporting partial results.');
      }
      
      // Stage 2: Enrich with Semantic Scholar (skip if user stopped early)
      if (!currentExportTask.stopRequested && CONFIG.enableSemanticScholar) {
        updateProgress('Enriching with Semantic Scholar data...', 35, '', 'Stage 2/3: Enriching with Semantic Scholar');
        await enrichWithSemanticScholar(citations, currentExportTask);
        
        if (currentExportTask.cancelled) {
          log('Export cancelled by user');
          return;
        }
      } else if (!CONFIG.enableSemanticScholar) {
        log('Semantic Scholar enrichment disabled via settings.');
      } else {
        log('Skipping enrichment due to user stop request.');
      }
      
      // Stage 3: Sort and export
      const exportMessage = currentExportTask.stopRequested ? 'Exporting partial results...' : 'Sorting and generating CSV...';
      updateProgress(exportMessage, 90, '', 'Stage 3/3: Generating Export');

      addDebugLog(`Preparing CSV export with ${citations.length} citations`);
      const finalCitations = CONFIG.autoSort ? sortByYear(citations) : citations;
      const filename = downloadCSV(finalCitations, paperTitle);

      addDebugLog(`✓ Export complete: ${filename}`, 'success');
      if (expectedTotal && finalCitations.length < expectedTotal) {
        addDebugLog(`Note: Exported ${finalCitations.length} of ${expectedTotal} expected (${expectedTotal - finalCitations.length} missing due to deduplication or filtering)`, 'warn');
      }

      updateProgress('Complete!', 100, '', 'Done');

      // Show success
      setTimeout(() => {
        showCompletionModal(finalCitations.length, filename);
      }, 500);
      
    } catch (e) {
      logError('Export error:', e);
      showErrorModal(`Export failed: ${e.message}`);
    }
  }

  // ==================== DOM Observation & Button Injection ====================

  // Track which entries have been processed
  const processedEntries = new WeakSet();
  
  // Inject button container on hover
  function handlePaperHover(paperEntry) {
    // Check if already has button container
    if (paperEntry.querySelector('.sre-button-container')) {
      return;
    }
    
    const titleLink = paperEntry.querySelector('.gs_rt a, .gs_rt');
    if (!titleLink) return;
    
    // Create and insert button container
    const container = createButtonContainer();
    const exportBtn = createExportButton(paperEntry);
    container.appendChild(exportBtn);
    
    // Insert after title
    const titleContainer = paperEntry.querySelector('.gs_rt');
    if (titleContainer) {
      titleContainer.style.position = 'relative';
      titleContainer.appendChild(container);
    }
  }

  // Remove button container on mouse leave
  function handlePaperLeave(paperEntry) {
    // Don't remove if we're in export mode
    if (isExporting) return;
    
    const container = paperEntry.querySelector('.sre-button-container');
    if (container) {
      // Small delay to prevent flicker when moving between title and button
      setTimeout(() => {
        if (!paperEntry.matches(':hover')) {
          container.remove();
        }
      }, 100);
    }
  }

  // Setup event listeners for paper entries
  function setupPaperEntry(entry) {
    if (processedEntries.has(entry)) return;
    processedEntries.add(entry);
    
    entry.addEventListener('mouseenter', () => handlePaperHover(entry));
    entry.addEventListener('mouseleave', () => handlePaperLeave(entry));
  }

  // Process all paper entries on the page
  function processAllEntries() {
    const entries = document.querySelectorAll('.gs_r.gs_or.gs_scl, .gs_ri, [data-cid]');
    entries.forEach(setupPaperEntry);
  }

  // Setup MutationObserver for dynamic content
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }
      
      if (shouldProcess) {
        processAllEntries();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    return observer;
  }

  // ==================== Initialization ====================

  function init() {
    log('Initializing Scholar Reference Exporter');
    
    // Process existing entries
    processAllEntries();
    
    // Watch for new entries
    setupObserver();
    
    log('Initialization complete');
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
