---
name: Test
description: Testing and hello-world operations
---

# Test Skill

Simple testing operations including hello-world message summarization.

## When to Use

- Test skill execution pipeline
- Verify AI summarization is working
- Simple message processing tests

## Operations

### hello
A simple hello-world operation that summarizes a message.

**Inputs:**
- `message` (string, required) - The message to process
- `limit` (number, optional) - Max sentences in summary (default: 10)

**Outputs:**
- `result` (string) - Summarized result
- `count` (number) - Number of key points

## Requirements

- AI model available for summarization