import { RONIN_VERSION, getLatestVersion, isUpdateAvailable } from "../../utils/version.js";

export async function handleVersionCommand(): Promise<void> {
  console.log(`🥷 Ronin v${RONIN_VERSION}`);

  try {
    const latest = await getLatestVersion();
    if (latest && isUpdateAvailable(RONIN_VERSION, latest)) {
      console.log(`\n📥 Update available: v${RONIN_VERSION} → v${latest}`);
      console.log(`💡 Run: bun run ronin update`);
    }
  } catch {
    // Silent fail on version check
  }
}
