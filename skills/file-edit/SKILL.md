---
name: file-edit
description: Create, read, and edit text files. Use to create input files for other skills (e.g. input.txt for mermaid-diagram-generator) or to store/retrieve plain text.
---

# File Edit Skill

Create, read, and edit plain text files under a safe workspace (`~/.ronin/workspace`) or under `~/.ronin` (e.g. to write input.txt into a skill folder). Use when the user or another skill needs a text file (e.g. "create input.txt with this content", "read the file", "append to file").

## When to Use

- User asks to create a text file or "write to a file"
- Another tool/skill needs an input file (e.g. mermaid-diagram-generator needs input.txt — create it first with this skill)
- User asks to read or edit a text file

## Abilities

### create
Create a new text file or overwrite an existing one.
- Input: path (relative to ~/.ronin/workspace, or path under ~/.ronin like skills/mermaid-diagram-generator/input.txt), content (text to write)
- Output: { path, created: true } or error
- Run: bun run scripts/create.ts

### read
Read the contents of a text file.
- Input: path (relative to ~/.ronin/workspace or under ~/.ronin)
- Output: { path, content: string } or error
- Run: bun run scripts/read.ts

### edit
Append or replace content in a file.
- Input: path, content, mode (optional: "append" | "replace", default "replace")
- Output: { path, mode, updated: true } or error
- Run: bun run scripts/edit.ts
