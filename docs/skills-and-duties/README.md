# Skills and Duties - Ronin Agents & Plugins Reference

This book provides a comprehensive reference guide to all built-in plugins and agents in Ronin, documenting their capabilities, methods, and usage patterns.

## Purpose

The "Skills and Duties" book serves as a complete catalog of:

- **Built-in Plugins**: All available plugins, their methods, and how to use them
- **Built-in Agents**: Pre-built agents that come with Ronin and how they work
- **Development Guides**: Patterns and best practices for creating custom plugins and agents

## Structure

The book is organized into four parts:

### Part 1: Built-in Plugins

Complete documentation for all 13 built-in plugins:

1. **Git Plugin** - Version control operations
2. **Shell Plugin** - Command execution
3. **Web Scraper Plugin** - Web content extraction
4. **Torrent Plugin** - Torrent management
5. **Telegram Plugin** - Telegram Bot API integration
6. **Discord Plugin** - Discord Bot API integration
7. **Email Plugin** - Email management with IMAP/SMTP
8. **Realm Plugin** - Peer-to-peer communication
9. **LangChain Plugin** - LangChain integration
10. **RAG Plugin** - Retrieval-Augmented Generation
11. **Grok Plugin** - Grok (xAI) API integration
12. **Gemini Plugin** - Google Gemini API integration
13. **Hyprland Plugin** - Hyprland window manager configuration

### Part 2: Built-in Agents

Documentation for agents that come with Ronin:

1. **Email Manager Agent** - Web UI and API for email management
2. **Telegram Bot Agent** - Multi-bot management interface
3. **RSS Feed Agent** - RSS feed monitoring and processing
4. **Example Agents** - Reference implementations

### Part 3: Plugin Development

Guides for creating custom plugins:

1. **Creating Custom Plugins** - Step-by-step plugin development
2. **Plugin Patterns & Best Practices** - Design patterns and conventions

### Part 4: Agent Development

Guides for creating custom agents:

1. **Creating Custom Agents** - Step-by-step agent development
2. **Agent Patterns & Best Practices** - Design patterns and conventions
3. **Inter-Agent Communication** - Event system and agent coordination

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
   node ../book/scripts/generate-pdf.js skills-and-duties/index.html output.pdf
   ```

### Alternative: Browser Print

1. Open `index.html` in Chrome/Chromium
2. Press Ctrl+P (Cmd+P on Mac)
3. Select "Save as PDF"
4. Configure margins and settings
5. Save

## Relationship to Main Documentation

This book complements the main Ronin documentation:

- **Main Book** (`../book/`) - Core concepts, architecture, and general usage
- **Skills and Duties** (this book) - Reference guide for specific plugins and agents

Use the main book to understand how Ronin works, and this book to look up specific plugin or agent capabilities.

## Contributing

When adding new plugins or agents to Ronin:

1. Add a chapter to the appropriate section (plugins or agents)
2. Update the table of contents in `index.html`
3. Include:
   - Overview and purpose
   - Complete method reference
   - Usage examples
   - Event system integration (if applicable)
   - Configuration options
   - See also links

## File Structure

```
skills-and-duties/
├── index.html              # Main book with table of contents
├── README.md               # This file
├── styles/
│   └── book.css            # Book styling (shared with main book)
└── chapters/
    ├── plugins/            # Plugin documentation chapters
    │   ├── 01-git-plugin.html
    │   ├── 02-shell-plugin.html
    │   ├── ...
    │   └── 07-email-plugin.html
    └── agents/             # Agent documentation chapters
        ├── 01-email-manager.html
        ├── 02-telegram-bot.html
        └── ...
```

## Customization

Edit `styles/book.css` to customize the book's appearance. The CSS includes print media queries for PDF generation.
