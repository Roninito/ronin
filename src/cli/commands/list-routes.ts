export interface ListRoutesOptions {
  port?: number;
}

/**
 * Fetch and print all routes from a running Ronin instance
 */
export async function listRoutesCommand(options: ListRoutesOptions = {}): Promise<void> {
  const port = options.port
    || (process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000);

  try {
    const response = await fetch(`http://localhost:${port}/api/routes`, {
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch routes (HTTP ${response.status}). Is Ronin running?`);
      console.log("💡 Start it with: ronin start");
      return;
    }

    const data = await response.json();
    const routes = data?.routes || [];

    console.log("\n🧭 Ronin Routes\n");
    console.log(`🟢 Server: http://localhost:${port}`);
    console.log(`   Total Routes: ${routes.length}\n`);

    if (routes.length === 0) {
      console.log("No routes registered.");
      return;
    }

    for (const route of routes) {
      const type = route.type ? route.type.toUpperCase() : "ROUTE";
      console.log(`   [${type}] ${route.url}`);
      if (route.description) {
        console.log(`          ${route.description}`);
      }
    }

    console.log();
  } catch {
    console.error("❌ Could not connect to Ronin. Is it running?");
    console.log("💡 Start it with: ronin start");
  }
}
