import { loadConfig, ensureDefaultDutyDir, ensureDefaultExternalDutyDir } from "./config.js";
import { logger } from "../../utils/logger.js";
import { formatCronTable } from "../../utils/cron.js";
import { loadDutyFileMetadata } from "../utils/duty-metadata.js";

export interface ListOptions {
  dutyDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * List command: Show all registered duties and their schedules
 */
export async function listCommand(options: ListOptions = {}): Promise<void> {
  const config = await loadConfig();
  const dutyDir = options.dutyDir || config.dutyDir || ensureDefaultDutyDir();
  const externalDutyDir =
    process.env.RONIN_EXTERNAL_DUTY_DIR || config.externalDutyDir || ensureDefaultExternalDutyDir();

  const duties = await loadDutyFileMetadata(dutyDir, externalDutyDir);

  if (duties.length === 0) {
    logger.info("No duties found.");
    return;
  }

  logger.info(`\n📋 Found ${duties.length} duty(s):\n`);
  for (const duty of duties) {
    logger.info(`🤖 ${duty.name}`);
    if (duty.schedule) {
      logger.info(`   Schedule: ${duty.schedule}`);
      const table = formatCronTable(duty.schedule);
      console.log(table);
    }
    if (duty.watch && duty.watch.length > 0) logger.info(`   Watch: ${duty.watch.join(", ")}`);
    if (duty.webhook) logger.info(`   Webhook: ${duty.webhook}`);
    logger.info("");
  }
}

