---
name: notion-assistant
description: Save notes, ideas, and text to Notion. List pages, read content, and create new pages.
---

# Notion Assistant

Save your notes, ideas, meeting notes, and any text content directly to your Notion workspace.

## Abilities

### list

List all pages in your Notion workspace.

**Input:** (optional)

**Output:** List of pages with titles, URLs, and last edited dates

**Run:** `bun run scripts/run.ts --ability=list`

### read

Read the content of a specific Notion page by title.

**Input:** Page title (e.g., "Meeting Notes")

**Output:** Full page content in markdown format

**Run:** `bun run scripts/run.ts --ability=read --input="Page Title"`

### write

Create a new page with your content.

**Input:** JSON with title and content

**Output:** Created page info with URL

**Run:** `bun run scripts/run.ts --ability=write --input='{"title":"My Note","content":"Content here"}'`

### search

Search for pages in your Notion workspace by keyword.

**Input:** Search query

**Output:** Matching pages with titles and URLs

**Run:** `bun run scripts/run.ts --ability=search --input="keyword"`

## Setup

1. Create integration at https://www.notion.so/my-integrations
2. Set `NOTION_API_KEY` environment variable
3. Share your Notion databases with the integration
4. See SETUP.md for detailed instructions
