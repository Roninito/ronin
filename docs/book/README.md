# Ronin & Realm Documentation Book

This directory contains the complete documentation book for Ronin and Realm in HTML format, ready to be converted to PDF.

## Structure

- `index.html` - Main book with table of contents
- `chapters/` - Individual chapter files
- `styles/book.css` - Professional book styling
- `scripts/generate-pdf.js` - PDF generation script

## Viewing the Book

### In Browser

Open `index.html` in your web browser to view the book with navigation.

### Generate PDF

1. Install dependencies:
   ```bash
   npm install puppeteer
   ```

2. Generate PDF:
   ```bash
   node scripts/generate-pdf.js
   ```

   Or specify output path:
   ```bash
   node scripts/generate-pdf.js output.pdf
   ```

### Alternative: Browser Print

1. Open `index.html` in Chrome/Chromium
2. Press Ctrl+P (Cmd+P on Mac)
3. Select "Save as PDF"
4. Configure margins and settings
5. Save

## Chapters

The book is organized into 7 parts:

1. **Introduction & Getting Started** - What is Ronin, Installation
2. **Ronin Core System** - Architecture, CLI, Configuration
3. **Realm** - Peer-to-peer communication
4. **Writing Agents** - Agent basics, scheduling, API, examples
5. **Plugins & Extensibility** - Using and creating plugins
6. **AI & Tool Calling** - AI integration and function calling
7. **Advanced Topics** - Memory, events, production, troubleshooting

Plus appendices with API reference, configuration, examples, and glossary.

## Customization

Edit `styles/book.css` to customize the book's appearance. The CSS includes print media queries for PDF generation.
