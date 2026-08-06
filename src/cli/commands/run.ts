import { createAPI } from "../../api/index.js";
import { DutyLoader } from "../../duty/DutyLoader.js";
import { DutyRegistry } from "../../duty/DutyRegistry.js";
import { loadConfig, ensureDefaultDutyDir, ensureDefaultExternalDutyDir } from "./config.js";
import { logger } from "../../utils/logger.js";

export interface RunOptions {
  dutyName: string;
  dutyDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Run command: Execute a specific duty manually
 */
export async function runCommand(options: RunOptions): Promise<void> {
  const config = await loadConfig();
  const dutyDir = options.dutyDir || config.dutyDir || ensureDefaultDutyDir();
  const externalDutyDir =
    process.env.RONIN_EXTERNAL_DUTY_DIR || config.externalDutyDir || ensureDefaultExternalDutyDir();

  logger.info(`Running duty: ${options.dutyName}`);

  // Create API (use fast model by default for duty execution speed)
  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    useFastModelForAgents: true,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir || config.pluginDir,
  });

  // Load duties
  const loader = new DutyLoader(dutyDir, externalDutyDir);
  const duties = await loader.loadAllDuties(api);

  // Find the duty
  const duty = duties.find(d => d.name === options.dutyName);
  if (!duty) {
    logger.error("Duty not found", { duty: options.dutyName, available: duties.map(d => d.name) });
    process.exit(1);
  }

  // Execute the duty
  try {
    await duty.instance.execute();
    logger.info(`Duty ${options.dutyName} completed successfully`);
  } catch (error) {
    logger.error("Error executing duty", { duty: options.dutyName, error });
    process.exit(1);
  }
}

