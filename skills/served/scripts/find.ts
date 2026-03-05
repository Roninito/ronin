/**
 * Find servers matching specific criteria (port, protocol, process name).
 * Outputs JSON: { servers: Array<{ port, protocol, process, pid, user, address }> }
 */
import { execSync } from "child_process";
import { parseArgs } from "./utils.js";
import { parseLsofOutput, type ServerInfo } from "./utils.js";

function main() {
  const args = parseArgs();
  const portFilter = args.port ? parseInt(args.port, 10) : undefined;
  const protocolFilter = args.protocol?.toLowerCase();
  const processFilter = args.process?.toLowerCase();
  
  try {
    // Build lsof command
    // If port is specified, use -i:port format directly
    // Otherwise use -i flag
    let command = "lsof -P -n";
    
    if (portFilter !== undefined) {
      // Port specified - use specific port filter
      if (protocolFilter === "tcp") {
        command += ` -iTCP:${portFilter}`;
      } else if (protocolFilter === "udp") {
        command += ` -iUDP:${portFilter}`;
      } else {
        command += ` -i:${portFilter}`;
      }
    } else {
      // No port filter - use general -i flag
      command += " -i";
      if (protocolFilter === "tcp") {
        command += "TCP";
      } else if (protocolFilter === "udp") {
        command += "UDP";
      }
    }
    
    // Execute command and filter for LISTEN state
    const output = execSync(command, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    
    // Filter for LISTEN state in the output
    const listenLines = output.split("\n").filter(line => line.includes("LISTEN"));
    
    if (listenLines.length === 0) {
      console.log(JSON.stringify({ servers: [] }));
      return;
    }
    
    // Add header line for parsing
    const headerLine = "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME";
    let servers = parseLsofOutput(headerLine + "\n" + listenLines.join("\n"));
    
    // Filter by process name if specified
    if (processFilter) {
      servers = servers.filter(s => 
        s.process.toLowerCase().includes(processFilter)
      );
    }
    
    // Sort by port
    servers.sort((a, b) => a.port - b.port);
    
    console.log(JSON.stringify({ servers }));
  } catch (error: any) {
    // If grep returns no matches, lsof exits with code 1
    if (error.status === 1) {
      // No servers found
      console.log(JSON.stringify({ servers: [] }));
    } else {
      console.error(JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        servers: [] 
      }));
      process.exit(1);
    }
  }
}

main();
