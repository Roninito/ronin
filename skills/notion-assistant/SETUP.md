# Notion Assistant Skill - Setup Guide

## Overview

The Notion Assistant skill lets you save notes, ideas, and text content directly to your Notion workspace via Telegram. It supports:

- **list** - List all pages in your Notion workspace
- **read** - Read content of a specific page by title
- **write** - Create new pages with your content
- **search** - Search for pages by keyword

## Setup Steps

### 1. Create Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click "+ New integration"
3. Give it a name (e.g., "Ronin Assistant")
4. Select your workspace
5. Click "Submit"
6. Copy the **Internal Integration Token** (starts with `secret_...`)

### 2. Configure API Key

Add the API key to your environment:

```bash
export NOTION_API_KEY="secret_your_integration_token_here"
```

Or add it to `~/.ronin/config.json`:

```json
{
  "notion": {
    "apiKey": "secret_your_token_here"
  }
}
```

### 3. Share Database with Integration

1. Open the Notion database you want to use
2. Click the "..." menu (top right)
3. Click "Connections"
4. Click "Add connections"
5. Select your integration ("Ronin Assistant")
6. Click "Confirm"

### 4. Test the Skill

```bash
# List pages
bun run ~/.ronin/skills/notion-assistant/scripts/run.ts --ability=list

# Search for pages
bun run ~/.ronin/skills/notion-assistant/scripts/run.ts --ability=search --input="meeting"

# Read a page
bun run ~/.ronin/skills/notion-assistant/scripts/run.ts --ability=read --input="My Page Title"

# Create a new page
bun run ~/.ronin/skills/notion-assistant/scripts/run.ts --ability=write --input='{"title":"My Note","content":"This is my content"}'
```

## Usage via Telegram

Once set up, use via Telegram:

```
@ronin list my notion pages
@ronin search notion for "meeting notes"
@ronin read notion page "Project Ideas"
@ronin save to notion: {"title":"Meeting Notes","content":"Discussed X, Y, Z"}
```

## Interactive Workflow (Coming Soon)

The skill will support interactive workflows:

1. **Save with destination selection:**
   - User: "@ronin save this to notion: [content]"
   - Bot: "Which database should I save to? 1) Personal 2) Work 3) Projects"
   - User: "2"
   - Bot: "✅ Saved to Work database: [URL]"

2. **Browse and select pages:**
   - User: "@ronin show my notion pages"
   - Bot: "Found 5 pages. Reply with number to read:"
   - User: "3"
   - Bot: "[Shows page content]"

## Troubleshooting

### "NOTION_API_KEY not configured"
- Make sure the environment variable is set
- Restart Ronin after setting the key

### "No Notion databases found"
- Create a database in Notion (table, board, or list view)
- Share the database with your integration (see step 3)

### "Page not found"
- Make sure the page is in a shared database
- Try searching with partial title match

### "Notion API error (403)"
- Your integration doesn't have access to that database
- Go to the database → ... → Connections → Add your integration

## File Structure

```
~/.ronin/skills/notion-assistant/
├── skill.md           # Skill definition and abilities
└── scripts/
    └── run.ts         # Main script with all abilities
```

## API Reference

### list
- **Input:** None
- **Output:** List of pages with titles and URLs

### read
- **Input:** Page title or ID
- **Output:** Page content in markdown format

### write
- **Input:** JSON `{title, content, parentDatabaseId?}`
- **Output:** Created page info with URL

### search
- **Input:** Search query (min 2 chars)
- **Output:** Matching pages with titles and URLs
