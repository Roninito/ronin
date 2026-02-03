#!/usr/bin/env node

/**
 * PDF Generation Script for Ronin & Realm Documentation Book
 * 
 * This script generates a PDF from the HTML book using Puppeteer.
 * 
 * Usage:
 *   node scripts/generate-pdf.js [output-path]
 * 
 * Requirements:
 *   npm install puppeteer
 */

const fs = require('fs');
const path = require('path');

// Check if puppeteer is available
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (error) {
  console.error('Error: puppeteer is not installed.');
  console.error('Install it with: npm install puppeteer');
  process.exit(1);
}

const bookDir = path.join(__dirname, '..');
const indexHtml = path.join(bookDir, 'index.html');
const outputPath = process.argv[2] || path.join(bookDir, 'ronin-realm-documentation.pdf');

async function generatePDF() {
  console.log('Starting PDF generation...');
  console.log(`Input: ${indexHtml}`);
  console.log(`Output: ${outputPath}`);

  if (!fs.existsSync(indexHtml)) {
    console.error(`Error: ${indexHtml} not found`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Load the index page
    await page.goto(`file://${indexHtml}`, {
      waitUntil: 'networkidle0'
    });

    // Generate PDF
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      margin: {
        top: '2cm',
        right: '2cm',
        bottom: '2cm',
        left: '2cm'
      },
      printBackground: true,
      preferCSSPageSize: true
    });

    console.log(`✅ PDF generated successfully: ${outputPath}`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Alternative: Generate PDF from all chapters combined
async function generatePDFFromChapters() {
  console.log('Generating PDF from all chapters...');
  
  const chapters = [
    'chapters/01-introduction.html',
    'chapters/02-installation.html',
    'chapters/03-architecture.html',
    'chapters/04-cli-reference.html',
    'chapters/05-configuration.html',
    'chapters/06-realm-overview.html',
    'chapters/07-realm-setup.html',
    'chapters/08-realm-usage.html',
    'chapters/09-agent-basics.html',
    'chapters/10-agent-scheduling.html',
    'chapters/11-agent-api-reference.html',
    'chapters/12-agent-examples.html',
    'chapters/13-plugin-overview.html',
    'chapters/14-using-plugins.html',
    'chapters/15-creating-plugins.html',
    'chapters/16-built-in-plugins.html',
    'chapters/17-ai-integration.html',
    'chapters/18-function-calling.html',
    'chapters/19-memory-state.html',
    'chapters/20-event-system.html',
    'chapters/21-production-deployment.html',
    'chapters/22-troubleshooting.html',
    'chapters/appendices/A-api-reference.html',
    'chapters/appendices/B-config-reference.html',
    'chapters/appendices/C-examples.html',
    'chapters/appendices/D-glossary.html'
  ];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    const pdfPages = [];

    for (const chapter of chapters) {
      const chapterPath = path.join(bookDir, chapter);
      if (fs.existsSync(chapterPath)) {
        console.log(`Processing: ${chapter}`);
        await page.goto(`file://${chapterPath}`, {
          waitUntil: 'networkidle0'
        });
        
        const pdf = await page.pdf({
          format: 'Letter',
          margin: {
            top: '2cm',
            right: '2cm',
            bottom: '2cm',
            left: '2cm'
          },
          printBackground: true,
          preferCSSPageSize: true
        });
        
        pdfPages.push(pdf);
      }
    }

    // Combine PDFs (requires pdf-lib or similar)
    console.log(`✅ Processed ${pdfPages.length} chapters`);
    console.log('Note: For combining PDFs, consider using pdf-lib or pdftk');
    console.log(`Individual PDFs can be combined manually or with: pdftk *.pdf cat output combined.pdf`);
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Run based on command line argument
if (process.argv.includes('--chapters')) {
  generatePDFFromChapters();
} else {
  generatePDF();
}
