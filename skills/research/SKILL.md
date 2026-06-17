---
name: Research
description: Web research and summarization capabilities
---

# Research Skill

Perform web research including page scraping and summarization.

## When to Use

- Scrape and summarize web pages
- Extract key information from URLs
- Generate concise summaries of web content

## Operations

### web-summary
Scrape a web page and return a concise AI summary of its content.

**Inputs:**
- `url` (string, required) - The URL to scrape and summarize
- `limit` (number, optional) - Max sentences in summary (default: 5)

**Outputs:**
- `summary` (string) - Concise summary of the web page
- `count` (number) - Number of key points identified
- `url` (string) - Source URL

## Requirements

- Web scraper tool available
- AI model for summarization