import { createAPI } from "../../api/index.js";

export interface RealmDiscoverOptions {
  callsign: string;
  dutyDir?: string;
  pluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
}

export async function realmDiscoverCommand(options: RealmDiscoverOptions): Promise<void> {
  const api = await createAPI({
    // dutyDir is intentionally not forwarded: createAPI has no such option (this realm
    // command never loads duties), even though --duty-dir is still accepted for CLI
    // consistency with the other subcommands.
    pluginDir: options.pluginDir,
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
  });

  if (!api.realm) {
    console.error("❌ Realm plugin not found. Make sure plugins/realm.ts exists.");
    console.log("   Use 'ronin realm connect' to connect to a Realm server first.");
    process.exit(1);
  }

  try {
    console.log(`🔍 Discovering peer: ${options.callsign}...`);
    
    const status = await api.realm.getPeerStatus(options.callsign);

    if (status.online) {
      console.log(`✅ Peer ${options.callsign} is online`);
      console.log(`   WebSocket address: ${status.wsAddress}`);
    } else {
      console.log(`❌ Peer ${options.callsign} is offline or not found`);
    }
  } catch (error) {
    console.error("❌ Failed to discover peer:", error instanceof Error ? error.message : String(error));
    console.log("   Make sure you're connected to Realm: 'ronin realm connect'");
    process.exit(1);
  }
}
