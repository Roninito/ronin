---
name: Apple Notes
description: Save and manage notes in Apple Notes app
---

# Apple Notes Skill

Save titled notes to Apple Notes from Ronin automation.

## When to Use

- Save important information to Apple Notes
- Create structured notes with titles and folders
- Archive AI outputs or conversation summaries

## Operations

### save-to-apple-notes
Save a titled note to Apple Notes.

**Inputs:**
- `title` (string, required) - Title of the note
- `body` (string, required) - Body content of the note
- `folder` (string, optional) - Target folder in Apple Notes (default: "Ronin")

**Outputs:**
- `success` (boolean) - Whether the note was saved
- `title` (string) - Title of the saved note

## Requirements

- macOS with Apple Notes app
- AppleScript access enabled