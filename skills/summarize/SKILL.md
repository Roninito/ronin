---
name: Summarize
description: Summarize text (e.g. a batch of chat messages) with the locally-configured AI model. Use as a middle phase between a "read" skill and a "send" skill.
---

# Summarize Skill

Condenses arbitrary text into a short summary using Ronin's configured local Ollama model. Designed to sit between a phase that reads content (e.g. `discord` `read_messages`) and a phase that posts somewhere (e.g. `telegram` `send_message`) in a kata.

## When to Use

- A kata phase needs to turn a batch of messages/text into a short digest before forwarding it elsewhere
- Any "read X, summarize it, send to Y" automation

## Requirements

- A local Ollama server reachable at `OLLAMA_URL` (env or Ronin config `ai.ollamaUrl`, default `http://localhost:11434`) running `OLLAMA_MODEL` (env or Ronin config `ai.ollamaModel`)

## Abilities

### summarize
Summarize text into a short digest.
- Input: input (string — plain text, or JSON; if JSON contains an `output.messages` array of `{author, content}` items, e.g. a discord `read_messages` result, those are formatted into the summary input automatically), instructions (optional string — extra framing, e.g. "Focus on decisions made")
- Output: { summary } or error
- Run: bun run scripts/summarize.ts --input={input} --instructions={instructions}
