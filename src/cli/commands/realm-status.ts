import { createAPI } from "../../api/index.js";

export interface RealmStatusOptions {
  agentDir?: string;
  pluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
}

export async function realmStatusCommand(options: RealmStatusOptions): Promise<void> {
  const api = await createAPI({
    agentDir: options.agentDir,
    pluginDir: options.pluginDir,
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
  });

  if (!api.realm) {
    console.error("❌ Realm plugin not found. Make sure plugins/realm.ts exists.");
    console.log("   Use 'ronin realm connect' to connect to a Realm server.");
    process.exit(1);
  }

  // Check if realm is initialized by trying to get status
  // (This is a simple check - in a real implementation, we'd track connection state)
  console.log("📡 Realm Status:");
  console.log("   Plugin loaded: ✅");
  console.log("   Note: Connection status requires active Realm connection.");
  console.log("   Use 'ronin realm connect' to establish connection.");
}
