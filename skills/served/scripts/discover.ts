/**
 * Discover all servers running on the local machine.
 * Outputs JSON: { servers: Array<{ port, protocol, process, pid, user, address }> }
 */
import { execSync } from "child_process";
import { parseLsofOutput, type ServerInfo } from "./utils.js";

function main() {
  try {
    // Use lsof to find all listening sockets
    // -i: network files
    // -P: don't convert port numbers to port names
    // -n: don't convert IP addresses to hostnames (faster)
    const output = execSync("lsof -i -P -n | grep LISTEN", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    
    // Add header line for parsing
    const headerLine = "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME";
    const servers = parseLsofOutput(headerLine + "\n" + output);
    
    // Sort by port
    servers.sort((a, b) => a.port - b.port);
    
    console.log(JSON.stringify({ servers }));
  } catch (error: any) {
    // If grep returns no matches, lsof exits with code 1
    if (error.status === 1 && error.stdout) {
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
