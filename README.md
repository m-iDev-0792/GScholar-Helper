# Scholar Reference Exporter

A Chrome extension that enhances Google Scholar by allowing you to export all citing papers (references) of any paper with enriched metadata.

## Features

- **One-Click Export**: Hover over any paper title on Google Scholar to reveal the "Export All References" button
- **Automatic Pagination**: Automatically traverses all pages of citing papers
- **Metadata Enrichment**: Uses Semantic Scholar API to enrich paper metadata with:
  - Clean, structured author names
  - Venue (journal/conference)
  - Full abstracts
  - Open access PDF links
- **CSV Export**: Exports all data to a well-formatted CSV file
- **Progress Tracking**: Real-time progress indicator with cancel option
- **Smart Rate Limiting**: Built-in delays to avoid triggering anti-bot measures

## Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `scholar-reference-exporter` folder
6. The extension icon should appear in your toolbar

### File Structure

```
scholar-reference-exporter/
├── manifest.json        # Extension configuration
├── content.js          # Main logic (runs on Scholar pages)
├── utils.js            # Utility functions
├── background.js       # Service worker for downloads
├── styles.css          # UI styles
├── popup.html          # Settings popup
├── popup.js            # Popup logic
├── icons/              # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # This file
```

## Usage

1. Navigate to [Google Scholar](https://scholar.google.com)
2. Search for any topic or paper
3. **Hover** over a paper title in the search results
4. Click the **"Export All References"** button that appears
5. Wait for the export to complete (progress is shown)
6. The CSV file will be downloaded automatically

## Exported Data

The CSV file includes the following columns:

| Column | Description |
|--------|-------------|
| Title | Paper title |
| Authors | List of authors (semicolon-separated) |
| Venue | Journal or conference name |
| Year | Publication year |
| PDF URL | Link to PDF (if available) |
| Abstract | Paper abstract |
| Scholar URL | Google Scholar link |

## Settings

Click the extension icon to access settings:

- **Max References**: Maximum number of papers to export (default: 1000)
- **Semantic Scholar**: Enable/disable API enrichment
- **Auto Sort**: Sort results by year (newest first)

## Technical Details

### Architecture

The extension uses a hybrid approach:

1. **Google Scholar**: Enumerates all citing papers (most comprehensive coverage)
2. **Semantic Scholar API**: Enriches metadata (clean structure, full abstracts)

### Rate Limiting

- Random delays (1.5-4 seconds) between Scholar page requests
- 200ms delays between Semantic Scholar API calls
- Automatic handling of rate limit responses

### Permissions

- `downloads`: To save CSV files
- `storage`: To persist settings
- `host_permissions`: 
  - Google Scholar domains
  - Semantic Scholar API

## Troubleshooting

### "Rate limited by Google Scholar"

Google Scholar may temporarily block requests if too many are made. Solutions:
- Wait a few minutes and try again
- Use a different network/VPN
- Complete any CAPTCHA that appears

### "No citations found"

This can occur when:
- The paper has no citations yet
- Google Scholar's HTML structure has changed
- The page hasn't fully loaded

### Button doesn't appear

Try:
- Refreshing the page
- Checking if the extension is enabled
- Looking at the browser console for errors

## Privacy

- No data is sent to third parties except Semantic Scholar API for metadata enrichment
- All processing happens locally in your browser
- No user data is collected or stored externally

## Known Limitations

- Maximum ~1000 references per export (configurable)
- Semantic Scholar may not have data for all papers
- Google Scholar's anti-bot measures may require CAPTCHAs

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - Feel free to use, modify, and distribute.

## Disclaimer

This extension is not affiliated with Google or Semantic Scholar. Use responsibly and in accordance with their terms of service.
