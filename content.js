/**
 * Scholar Reference Exporter - Content Script
 * Handles Google Scholar page interaction and reference extraction
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    maxReferences: 1000,
    minDelay: 1500,
    maxDelay: 4000,
    semanticScholarBatchSize: 10,
    semanticScholarDelay: 200,
    similarityThreshold: 0.6,
    captchaCheckInterval: 2000,
    captchaTimeout: 300000 // 5 minutes max wait for captcha
  };

  // State management
  let currentExportTask = null;
  let isExporting = false;
  let captchaWindow = null;

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
      <div class="sre-modal">
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
          <div class="sre-progress-details">
            <span id="sre-progress-details"></span>
          </div>
          <div class="sre-progress-stage" id="sre-progress-stage"></div>
        </div>
        <div class="sre-modal-footer">
          <button class="sre-btn sre-btn-secondary" id="sre-cancel-export-btn">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Setup cancel handlers
    const cancelBtn = document.getElementById('sre-cancel-btn');
    const cancelExportBtn = document.getElementById('sre-cancel-export-btn');
    
    const handleCancel = () => {
      if (currentExportTask) {
        currentExportTask.cancelled = true;
      }
      closeProgressModal();
    };
    
    cancelBtn.addEventListener('click', handleCancel);
    cancelExportBtn.addEventListener('click', handleCancel);
    
    return overlay;
  }

  // Update progress modal
  function updateProgress(text, percent, details = '', stage = '') {
    const progressText = document.getElementById('sre-progress-text');
    const progressBar = document.getElementById('sre-progress-bar');
    const progressDetails = document.getElementById('sre-progress-details');
    const progressStage = document.getElementById('sre-progress-stage');
    
    if (progressText) progressText.textContent = text;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressDetails) progressDetails.textContent = details;
    if (progressStage) progressStage.textContent = stage;
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

  // Show completion modal
  function showCompletionModal(count, filename) {
    closeProgressModal();
    
    const overlay = document.createElement('div');
    overlay.className = 'sre-modal-overlay';
    overlay.id = 'sre-completion-modal';
    
    overlay.innerHTML = `
      <div class="sre-modal sre-modal-success">
        <div class="sre-modal-header">
          <h3>✓ Export Complete</h3>
          <button class="sre-modal-close" id="sre-close-completion">✕</button>
        </div>
        <div class="sre-modal-body">
          <p>Successfully exported <strong>${count}</strong> references.</p>
          <p class="sre-filename">File: ${filename}</p>
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
    
    overlay.innerHTML = `
      <div class="sre-modal sre-modal-error">
        <div class="sre-modal-header">
          <h3>✕ Export Failed</h3>
          <button class="sre-modal-close" id="sre-close-error">✕</button>
        </div>
        <div class="sre-modal-body">
          <p>${message}</p>
        </div>
        <div class="sre-modal-footer">
          <button class="sre-btn sre-btn-primary" id="sre-close-error-btn">Close</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const closeBtn = document.getElementById('sre-close-error');
    const closeErrorBtn = document.getElementById('sre-close-error-btn');
    
    const handleClose = () => overlay.remove();
    
    closeBtn.addEventListener('click', handleClose);
    closeErrorBtn.addEventListener('click', handleClose);
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
  function findCitedByLink(paperEntry) {
    const links = paperEntry.querySelectorAll('.gs_fl a, .gs_fl2 a');
    for (const link of links) {
      const text = link.textContent.trim();
      if (text.match(/^Cited by \d+/i)) {
        return link.href;
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

  // Fetch all citations from Google Scholar (with pagination)
  async function fetchAllCitations(citedByUrl, task) {
    const allCitations = [];
    let currentUrl = citedByUrl;
    let pageNum = 1;
    let retryCount = 0;
    const maxRetries = 3;
    const seenCitationKeys = new Set();
    
    while (currentUrl && !task.cancelled) {
      // Check max limit
      if (allCitations.length >= CONFIG.maxReferences) {
        log(`Reached max reference limit (${CONFIG.maxReferences})`);
        break;
      }
      
      updateProgress(
        `Fetching page ${pageNum}...`,
        Math.min(30, pageNum * 3),
        `Found ${allCitations.length} references so far`,
        'Stage 1/3: Collecting from Google Scholar'
      );
      
      try {
        const response = await fetch(currentUrl, {
          credentials: 'include',
          headers: {
            'Accept': 'text/html',
          }
        });
        
        if (!response.ok) {
          if (response.status === 429) {
            logError('Rate limited by Google Scholar (HTTP 429)');
            // Try to handle with CAPTCHA flow
            if (retryCount < maxRetries) {
              retryCount++;
              await handleCaptcha(currentUrl);
              continue; // Retry the same page
            }
            throw new Error('Rate limited by Google Scholar. Please wait a few minutes and try again.');
          }
          throw new Error(`Failed to fetch page: ${response.status}`);
        }
        
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Check for CAPTCHA
        if (isCaptchaPage(html)) {
          log('CAPTCHA page detected');
          if (retryCount < maxRetries) {
            retryCount++;
            await handleCaptcha(currentUrl);
            continue; // Retry the same page after CAPTCHA
          }
          throw new Error('Unable to bypass CAPTCHA. Please try again later.');
        }
        
        // Reset retry count on successful page
        retryCount = 0;
        
        // Parse citations from this page
        const pageCitations = parseCitationsFromPage(doc);
        log(`Page ${pageNum}: found ${pageCitations.length} citations`);
        
        if (pageCitations.length === 0) {
          // No more results
          break;
        }
        
        // Deduplicate across pages/results by Scholar id/url/title-year
        for (const citation of pageCitations) {
          const keys = buildDedupKeys(citation);
          const isDuplicate = keys.some(key => seenCitationKeys.has(key));
          if (isDuplicate) {
            continue;
          }
          keys.forEach(key => seenCitationKeys.add(key));
          allCitations.push(citation);
        }
        
        // Find next page
        currentUrl = findNextPageLink(doc);
        pageNum++;
        
        // Rate limiting delay
        if (currentUrl) {
          await randomSleep(CONFIG.minDelay, CONFIG.maxDelay);
        }
        
      } catch (e) {
        logError('Error fetching citations:', e);
        throw e;
      }
    }
    
    return allCitations;
  }

  // ==================== Semantic Scholar API ====================

  // Search for a paper in Semantic Scholar
  async function searchSemanticScholar(title, year) {
    const query = encodeURIComponent(title);
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&limit=5&fields=paperId,title,year,authors,venue,abstract,openAccessPdf`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited, wait and retry once
          await sleep(1000);
          const retryResponse = await fetch(url);
          if (!retryResponse.ok) return null;
          return await retryResponse.json();
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
    
    for (const citation of citations) {
      if (task.cancelled) break;
      
      processed++;
      updateProgress(
        `Enriching metadata (${processed}/${total})...`,
        30 + Math.floor((processed / total) * 50),
        `Processing: ${citation.title.substring(0, 50)}...`,
        'Stage 2/3: Enriching with Semantic Scholar'
      );
      
      try {
        const ssResults = await searchSemanticScholar(citation.title, citation.year);
        const match = findBestMatch(citation, ssResults);
        
        if (match) {
          // Update with better data from Semantic Scholar
          if (match.authors && match.authors.length > 0) {
            citation.authors = match.authors.map(a => a.name).join('; ');
          }
          if (match.venue) {
            citation.venue = match.venue;
          }
          if (match.year) {
            citation.year = match.year;
          }
          if (match.abstract && (!citation.abstract || citation.abstract.length < match.abstract.length)) {
            citation.abstract = match.abstract;
          }
          if (match.openAccessPdf && match.openAccessPdf.url) {
            citation.pdfUrl = match.openAccessPdf.url;
          }
          
          citation.semanticScholarId = match.paperId;
        }
        
        // Rate limiting for Semantic Scholar
        await sleep(CONFIG.semanticScholarDelay);
        
      } catch (e) {
        logError('Error enriching citation:', e);
        // Continue with other citations
      }
    }
    
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
    
    const filename = `references_${sanitizeFilename(paperTitle)}_${new Date().toISOString().split('T')[0]}.csv`;
    
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

  // ==================== Main Export Handler ====================

  async function handleExportClick(paperEntry, button) {
    if (isExporting) {
      log('Export already in progress');
      return;
    }
    
    // Find Cited by link
    const citedByUrl = findCitedByLink(paperEntry);
    if (!citedByUrl) {
      showErrorModal('Could not find "Cited by" link for this paper. The paper may have no citations.');
      return;
    }
    
    const paperTitle = getPaperTitle(paperEntry);
    log('Starting export for:', paperTitle);
    log('Cited by URL:', citedByUrl);
    
    isExporting = true;
    currentExportTask = { cancelled: false };
    
    createProgressModal();
    
    try {
      // Stage 1: Fetch all citations from Google Scholar
      updateProgress('Collecting citations from Google Scholar...', 5, '', 'Stage 1/3: Collecting from Google Scholar');
      const citations = await fetchAllCitations(citedByUrl, currentExportTask);
      
      if (currentExportTask.cancelled) {
        log('Export cancelled by user');
        return;
      }
      
      if (citations.length === 0) {
        showErrorModal('No citations found. The paper may have no citations or there was an error fetching them.');
        return;
      }
      
      log(`Collected ${citations.length} citations from Google Scholar`);
      
      // Stage 2: Enrich with Semantic Scholar
      updateProgress('Enriching with Semantic Scholar data...', 35, '', 'Stage 2/3: Enriching with Semantic Scholar');
      await enrichWithSemanticScholar(citations, currentExportTask);
      
      if (currentExportTask.cancelled) {
        log('Export cancelled by user');
        return;
      }
      
      // Stage 3: Sort and export
      updateProgress('Sorting and generating CSV...', 90, '', 'Stage 3/3: Generating Export');
      const sortedCitations = sortByYear(citations);
      const filename = downloadCSV(sortedCitations, paperTitle);
      
      updateProgress('Complete!', 100, '', 'Done');
      
      // Show success
      setTimeout(() => {
        showCompletionModal(sortedCitations.length, filename);
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
