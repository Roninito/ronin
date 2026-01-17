import { createAPI } from "../../api/index.js";

export interface RealmConnectOptions {
  url: string;
  callsign: string;
  token?: string;
  localPort?: number;
  agentDir?: string;
  pluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
}

export async function realmConnectCommand(options: RealmConnectOptions): Promise<void> {
  const api = await createAPI({
    agentDir: options.agentDir,
    pluginDir: options.pluginDir,
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
  });

  if (!api.realm) {
    console.error("❌ Realm plugin not found. Make sure plugins/realm.ts exists.");
    process.exit(1);
  }

  try {
    // Validate and fix URL format
    let url = options.url;
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      if (url.startsWith('ws:')) {
        url = url.replace('ws:', 'ws://');
        console.log(`⚠️  Fixed URL format: ${url}`);
      } else {
        url = `ws://${url}`;
        console.log(`⚠️  Added protocol: ${url}`);
      }
    }
    
    console.log(`🔌 Connecting to Realm at ${url}...`);
    console.log(`   Call sign: ${options.callsign}`);
    
    await api.realm.init(url, options.callsign, {
      token: options.token,
      localWsPort: options.localPort,
    });

    console.log("✅ Connected to Realm!");
    console.log("   Use 'ronin realm status' to check connection status");
    console.log("   Use 'ronin realm discover <callsign>' to find peers");
    console.log("\n   Keeping connection alive... (Press Ctrl+C to disconnect)");
    
    // Keep the process alive to maintain the WebSocket connection
    // The connection will be maintained until the process exits
    process.on('SIGINT', () => {
      console.log("\n👋 Disconnecting from Realm...");
      api.realm?.disconnect();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log("\n👋 Disconnecting from Realm...");
      api.realm?.disconnect();
      process.exit(0);
    });
    
    // Keep process alive indefinitely
    await new Promise(() => {}); // Never resolves, keeps process alive
  } catch (error) {
    console.error("❌ Failed to connect to Realm:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
