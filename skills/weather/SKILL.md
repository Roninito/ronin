---
name: weather
description: Current conditions and a short forecast for a location, formatted as a readable morning briefing. Uses Open-Meteo (no API key required).
---

# Weather Skill

Get current weather conditions and a short forecast for a location, formatted as a readable morning briefing.

## When to Use

- Get current weather conditions
- Retrieve a short-range forecast
- Generate a morning weather briefing

## Abilities

### morning-briefing
Get current weather and today's forecast, formatted as a readable morning briefing.
- Input: location (string, optional — a city/place name; omit or pass "current" to use the WEATHER_DEFAULT_LOCATION env var)
- Output: { success: true, briefing: string, conditions: string } or { success: false, error }
- Run: bun run scripts/morning-briefing.ts --location={location}

## Requirements

- No API key needed — uses Open-Meteo's free geocoding and forecast APIs.
- Set `WEATHER_DEFAULT_LOCATION` (e.g. "Austin, TX") in your environment for briefings that omit a location or pass "current" — the script has no access to real device location.
