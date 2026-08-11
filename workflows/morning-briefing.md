---
name: morning-briefing
description: Standard for what a morning briefing should cover and how it should read.
tags: [briefing, morning, daily, summary]
status: active
skills: [weather, apple-mail-skill, discord]
---

# Morning Briefing Workflow

## Purpose

A morning briefing should leave the reader knowing three things fast:
what the weather's doing, what came in overnight that needs attention, and
anything time-sensitive for today. Nothing more — this is a scan, not a
report.

## When to use

Any duty producing a daily/morning summary (e.g. the `morning-briefing`
kata, or a chat request like "give me my morning brief") should follow this.

## Standards & expectations

- Lead with anything urgent (overnight email flagged important, calendar
  conflicts) — weather and routine items come after.
- Keep it skimmable: short lines, no filler sentences like "I hope this
  finds you well."
- If a source (weather, mail) is unavailable, say so plainly instead of
  omitting the section silently.

## Steps

1. Get the weather forecast (weather skill).
2. Check the inbox for anything that arrived overnight (apple-mail-skill).
3. Combine into one briefing, urgent items first, and post it (discord
   skill, or whatever channel the request came in on).

## Notes

Kept intentionally close to the existing `katas/morning-briefing.kata`
phase graph — this document is the "why/standards" companion to that
kata's "what actually executes."
