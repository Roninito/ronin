---
name: Served
description: Discover and list servers running on the local machine (listening ports, processes, and services).
---

# Served Skill

Discover and list all servers running on the local machine. Identifies listening ports, associated processes, and service information.

## When to Use

- List all servers/services running on localhost
- Find what's listening on specific ports
- Identify processes running servers
- Get server details (port, protocol, process name, PID)

## Requirements

- macOS (uses `lsof` command)
- Appropriate permissions to query network connections

## Abilities

### discover
Discover all servers running on the local machine. Returns listening ports with process information.
- Input: None (optional filters: port, protocol)
- Output: { servers: Array<{ port, protocol, process, pid, user, address }> }
- Run: bun run scripts/discover.ts

### find
Find servers listening on a specific port or matching a pattern.
- Input: port (optional number), protocol (optional string: "tcp" | "udp"), process (optional string pattern)
- Output: { servers: Array<{ port, protocol, process, pid, user, address }> }
- Run: bun run scripts/find.ts --port={port} --protocol={protocol} --process={process}
