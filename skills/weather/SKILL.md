---
name: Weather
description: Weather information and morning briefings
---

# Weather Skill

Get current weather conditions and forecasts for location-aware briefings.

## When to Use

- Get current weather conditions
- Retrieve weather forecasts
- Generate morning weather briefings
- Location-based weather updates

## Operations

### morning-briefing
Get current weather and forecast, formatted as a readable morning briefing.

**Inputs:**
- `location` (string, optional) - City or location name (default: "current" - uses current location)

**Outputs:**
- `briefing` (string) - Formatted morning weather briefing
- `conditions` (string) - Current conditions summary

## Requirements

- Weather API access configured
- Location services if using "current" location