/**
 * Scholar Reference Exporter - Utility Functions
 */

// Sleep utility for rate limiting
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Random sleep between min and max milliseconds
function randomSleep(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(ms);
}

// Extract year from a string (looks for 4-digit year)
function extractYear(text) {
  if (!text) return null;
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

// Parse authors from Google Scholar meta line
function parseAuthorsFromMeta(metaLine) {
  if (!metaLine) return '';
  // Meta line format: "Authors - Venue, Year - Publisher" or similar
  const parts = metaLine.split(' - ');
  if (parts.length > 0) {
    // First part is usually authors
    return parts[0].trim();
  }
  return metaLine;
}

// Parse venue from Google Scholar meta line
function parseVenueFromMeta(metaLine) {
  if (!metaLine) return '';
  const parts = metaLine.split(' - ');
  if (parts.length > 1) {
    // Second part usually contains venue and year
    let venuePart = parts[1];
    // Remove year from venue
    venuePart = venuePart.replace(/,?\s*(19|20)\d{2}\s*$/, '').trim();
    return venuePart;
  }
  return '';
}

// Escape CSV field
function escapeCSVField(field) {
  if (field === null || field === undefined) {
    return '';
  }
  const str = String(field);
  // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Convert array of objects to CSV string
function toCSV(data, columns) {
  const header = columns.map(col => escapeCSVField(col.label)).join(',');
  const rows = data.map(item => {
    return columns.map(col => escapeCSVField(item[col.key])).join(',');
  });
  return header + '\n' + rows.join('\n');
}

// Sanitize filename
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

// Normalize title for comparison
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate similarity between two strings (simple Jaccard-like)
function titleSimilarity(title1, title2) {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);
  
  if (!norm1 || !norm2) return 0;
  
  const words1 = new Set(norm1.split(' '));
  const words2 = new Set(norm2.split(' '));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Create a unique ID
function generateId() {
  return 'sre_' + Math.random().toString(36).substring(2, 11);
}

// Log with prefix
function log(...args) {
  console.log('[Scholar Reference Exporter]', ...args);
}

// Error log with prefix
function logError(...args) {
  console.error('[Scholar Reference Exporter]', ...args);
}
