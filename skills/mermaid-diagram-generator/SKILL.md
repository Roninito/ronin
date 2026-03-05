---
name: Mermaid Diagram Generator
description: Generates Mermaid diagrams from text descriptions and outputs a shareable Mermaid Live Editor URL so users can view and edit the diagram.
---

## Abilities

### run
Generate a Mermaid diagram from arbitrary instructions, or pass through raw diagram code. No hardcoded templates — descriptions are sent to Ollama to generate the diagram.
- Input: input (optional string). Pass the user's full description (e.g. "flowchart for washing dishes") so the generated diagram and url match—or pass full Mermaid code to get a shareable url for it. If omitted or generic, skills.run may use the action text. Do not pass only "flowchart" when the user asked for a specific topic.
- Output: { success: boolean, diagram?: string, input: string, url?: string, error?: string }. Always use the url in the reply—it is a Mermaid Live Editor link (https://mermaid.live/edit#base64:...) so the user can view and edit the diagram. Requires Ollama running (optional env OLLAMA_HOST, default http://localhost:11434; OLLAMA_MODEL, default llama3.2).
- Run: bun run scripts/run.ts --input={input}