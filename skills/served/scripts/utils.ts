/**
 * Shared utilities for Served skill scripts
 */

export function parseArgs(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...v] = arg.slice(2).split("=");
      out[key] = v.join("=").trim();
    }
  }
  return out;
}

export interface ServerInfo {
  port: number;
  protocol: string;
  process: string;
  pid: number;
  user: string;
  address: string;
}

export function parseLsofOutput(output: string): ServerInfo[] {
  const servers: ServerInfo[] = [];
  const lines = output.trim().split("\n");
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // lsof -i format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    
    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    const user = parts[2];
    const name = parts.slice(8).join(" "); // NAME can contain spaces
    
    // Parse NAME field (e.g., "*:3000 (LISTEN)" or "localhost:8080")
    const nameMatch = name.match(/^(\*|[\w\.-]+):(\d+)\s*\((\w+)\)$/);
    if (!nameMatch) continue;
    
    const [, address, portStr, state] = nameMatch;
    const port = parseInt(portStr, 10);
    
    // Only include listening sockets
    if (state !== "LISTEN") continue;
    
    // Determine protocol from TYPE (parts[4])
    const type = parts[4] || "";
    const protocol = type.toLowerCase().includes("udp") ? "udp" : "tcp";
    
    servers.push({
      port,
      protocol,
      process: command,
      pid,
      user,
      address: address === "*" ? "0.0.0.0" : address,
    });
  }
  
  return servers;
}
