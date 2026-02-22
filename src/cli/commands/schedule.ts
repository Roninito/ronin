import { loadConfig, ensureDefaultAgentDir, ensureDefaultExternalAgentDir } from "./config.js";
import { logger } from "../../utils/logger.js";
import {
  formatCronTable,
  cronToHumanReadable,
  validateCronExpression,
  getCommonSchedules,
  parseCron,
  buildCronExpression,
} from "../../utils/cron.js";
import * as readline from "readline";
import { readFile, writeFile } from "fs/promises";
import { loadAgentFileMetadata, type AgentFileMetadata } from "../utils/agent-metadata.js";

export interface ScheduleOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Schedule command: Manage cron schedules for agents
 */
export async function scheduleCommand(
  args: string[],
  options: ScheduleOptions = {}
): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      await listScheduleCommand(options);
      break;

    case "build":
      await buildScheduleCommand(options);
      break;

    case "explain":
      const expression = args[1];
      if (!expression) {
        console.error("❌ Cron expression required");
        console.log("Usage: ronin schedule explain <expression>");
        process.exit(1);
      }
      await explainScheduleCommand(expression);
      break;

    case "validate":
      const expr = args[1];
      if (!expr) {
        console.error("❌ Cron expression required");
        console.log("Usage: ronin schedule validate <expression>");
        process.exit(1);
      }
      await validateScheduleCommand(expr);
      break;

    case "templates":
      await templatesScheduleCommand();
      break;

    case "apply":
      const agentName = args[1];
      const schedule = args[2];
      if (!agentName || !schedule) {
        console.error("❌ Agent name and schedule required");
        console.log("Usage: ronin schedule apply <agent-name> <schedule>");
        process.exit(1);
      }
      await applyScheduleCommand(agentName, schedule, options);
      break;

    default:
      console.error(`❌ Unknown schedule subcommand: ${subcommand || "(none)"}`);
      console.log("\nAvailable subcommands:");
      console.log("  ronin schedule list              - List all agents with schedules");
      console.log("  ronin schedule build             - Interactive schedule builder");
      console.log("  ronin schedule explain <expr>   - Explain a cron expression");
      console.log("  ronin schedule validate <expr>  - Validate a cron expression");
      console.log("  ronin schedule templates         - List common schedule templates");
      console.log("  ronin schedule apply <agent> <schedule> - Apply schedule to agent file");
      process.exit(1);
  }
}

/**
 * List all agents with schedules
 */
async function listScheduleCommand(options: ScheduleOptions): Promise<void> {
  const config = await loadConfig();
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir =
    process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir || ensureDefaultExternalAgentDir();

  const agents = await loadAgentFileMetadata(agentDir, externalAgentDir);

  const agentsWithSchedules = agents.filter((agent) => agent.schedule);

  if (agentsWithSchedules.length === 0) {
    logger.info("No agents with schedules found.");
    return;
  }

  logger.info(`\n📋 Agent Schedules\n`);

  for (const agent of agentsWithSchedules) {
    logger.info(`🤖 ${agent.name}`);
    logger.info(`   Schedule: ${agent.schedule}`);
    const table = formatCronTable(agent.schedule!);
    console.log(table);
    logger.info("");
  }
}

/**
 * Interactive schedule builder
 */
async function buildScheduleCommand(options: ScheduleOptions): Promise<void> {
  const config = await loadConfig();
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir =
    process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir || ensureDefaultExternalAgentDir();

  const agents = await loadAgentFileMetadata(agentDir, externalAgentDir);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(query, resolve);
    });
  };

  try {
    console.log("\n🕐 Schedule Builder\n");

    console.log("How often should this run?");
    console.log("  1. Every N minutes");
    console.log("  2. Every N hours");
    console.log("  3. Every N days");
    console.log("  4. At specific time");
    console.log("  5. Weekdays only");
    console.log("  6. Custom expression");

    const choice = await question("\nSelect option (1-6): ");

    let expression: string;

    switch (choice.trim()) {
      case "1": {
        const interval = await question("How many minutes? ");
        const n = parseInt(interval.trim()) || 5;
        expression = `*/${n} * * * *`;
        break;
      }

      case "2": {
        const interval = await question("How many hours? ");
        const minute = await question("At which minute (0-59)? ");
        const h = parseInt(interval.trim()) || 6;
        const m = parseInt(minute.trim()) || 0;
        expression = `${m} */${h} * * *`;
        break;
      }

      case "3": {
        const interval = await question("How many days? ");
        const minute = await question("At which minute (0-59)? ");
        const hour = await question("At which hour (0-23)? ");
        const d = parseInt(interval.trim()) || 1;
        const m = parseInt(minute.trim()) || 0;
        const h = parseInt(hour.trim()) || 0;
        expression = `${m} ${h} */${d} * *`;
        break;
      }

      case "4": {
        const time = await question("Time (HH:MM format, e.g., 09:00): ");
        const [hours, minutes] = time.trim().split(":").map((s) => parseInt(s) || 0);
        expression = `${minutes} ${hours} * * *`;
        break;
      }

      case "5": {
        const minute = await question("At which minute (0-59)? ");
        const hour = await question("At which hour (0-23)? ");
        const m = parseInt(minute.trim()) || 0;
        const h = parseInt(hour.trim()) || 9;
        expression = `${m} ${h} * * 1-5`;
        break;
      }

      case "6": {
        expression = await question("Enter cron expression (minute hour day month weekday): ");
        break;
      }

      default:
        console.error("❌ Invalid choice");
        rl.close();
        return;
    }

    expression = expression.trim();

    // Validate
    const validation = validateCronExpression(expression);
    if (!validation.valid) {
      console.error(`❌ Invalid expression: ${validation.error}`);
      rl.close();
      return;
    }

    // Show preview
    const human = cronToHumanReadable(expression);
    console.log("\n✅ Generated:");
    console.log(`   Expression: ${expression}`);
    console.log(`   Description: ${human.summary}`);
    console.log(`   Next runs: ${human.nextRuns.slice(0, 3).join(", ")}`);

    console.log("\nCopy this to your agent file:");
    console.log(`   static schedule = "${expression}";`);

    // Ask if user wants to apply
    const apply = await question("\nApply to an agent? (y/n): ");
    if (apply.trim().toLowerCase() === "y") {
      console.log("\nAvailable agents:");
      agents.forEach((agent, i) => {
        console.log(`  ${i + 1}. ${agent.name}${agent.schedule ? ` (current: ${agent.schedule})` : ""}`);
      });

      const agentChoice = await question("\nSelect agent number: ");
      const agentIndex = parseInt(agentChoice.trim()) - 1;

      if (agentIndex >= 0 && agentIndex < agents.length) {
        const selectedAgent = agents[agentIndex];
        await applyScheduleToFile(selectedAgent, expression);
        console.log(`\n✅ Schedule applied to ${selectedAgent.name}`);
      } else {
        console.error("❌ Invalid agent selection");
      }
    }

    rl.close();
  } catch (error) {
    rl.close();
    throw error;
  }
}

/**
 * Explain a cron expression
 */
async function explainScheduleCommand(expression: string): Promise<void> {
  const validation = validateCronExpression(expression);
  if (!validation.valid) {
    console.error(`❌ Invalid expression: ${validation.error}`);
    return;
  }

  const human = cronToHumanReadable(expression);
  console.log(`\n📝 Cron Expression: ${expression}\n`);
  console.log(`Description: ${human.summary}`);
  console.log("\nNext runs:");
  human.nextRuns.forEach((run, i) => {
    console.log(`  ${i + 1}. ${run}`);
  });

  console.log("\n" + formatCronTable(expression));
}

/**
 * Validate a cron expression
 */
async function validateScheduleCommand(expression: string): Promise<void> {
  const validation = validateCronExpression(expression);
  if (validation.valid) {
    console.log(`✅ Valid cron expression: ${expression}`);
    const human = cronToHumanReadable(expression);
    console.log(`   Description: ${human.summary}`);
  } else {
    console.error(`❌ Invalid cron expression: ${expression}`);
    console.error(`   Error: ${validation.error}`);
    process.exit(1);
  }
}

/**
 * List common schedule templates
 */
async function templatesScheduleCommand(): Promise<void> {
  const templates = getCommonSchedules();
  console.log("\n📋 Common Schedule Templates\n");

  templates.forEach((template) => {
    console.log(`📌 ${template.name}`);
    console.log(`   Expression: ${template.cron}`);
    console.log(`   Description: ${template.description}`);
    console.log("");
  });
}

/**
 * Apply schedule to agent file
 */
async function applyScheduleCommand(
  agentName: string,
  schedule: string,
  options: ScheduleOptions
): Promise<void> {
  const config = await loadConfig();
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir =
    process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir || ensureDefaultExternalAgentDir();

  // Validate schedule
  const validation = validateCronExpression(schedule);
  if (!validation.valid) {
    console.error(`❌ Invalid schedule: ${validation.error}`);
    process.exit(1);
  }

  const agents = await loadAgentFileMetadata(agentDir, externalAgentDir);

  const agent = agents.find((a) => a.name === agentName);
  if (!agent) {
    console.error(`❌ Agent ${agentName} not found`);
    process.exit(1);
  }

  await applyScheduleToFile(agent, schedule);
  console.log(`✅ Schedule applied to ${agentName}`);
  console.log(`   Expression: ${schedule}`);
  const human = cronToHumanReadable(schedule);
  console.log(`   Description: ${human.summary}`);
  console.log("\n💡 Hot reload will trigger automatically if Ronin is running.");
}

/**
 * Apply schedule to agent file
 */
async function applyScheduleToFile(
  agent: AgentFileMetadata,
  schedule: string
): Promise<void> {
  try {
    const filePath = agent.filePath;
    const content = await readFile(filePath, "utf-8");

    // Pattern to match: static schedule = "...";
    const scheduleRegex = /(static\s+schedule\s*=\s*)(["'])([^"']+)\2\s*;?/;
    const commentedScheduleRegex = /(\/\/\s*static\s+schedule\s*=\s*)(["'])([^"']+)\2\s*;?/;

    let newContent: string;

    // Check if schedule exists (commented or not)
    if (scheduleRegex.test(content)) {
      // Replace existing schedule
      newContent = content.replace(scheduleRegex, `static schedule = "${schedule}";`);
    } else if (commentedScheduleRegex.test(content)) {
      // Uncomment and update
      newContent = content.replace(
        commentedScheduleRegex,
        `static schedule = "${schedule}";`
      );
    } else {
      // Find class declaration and insert after it
      const classRegex = /(export\s+default\s+class\s+\w+\s+extends\s+\w+\s*\{)/;
      if (classRegex.test(content)) {
        newContent = content.replace(
          classRegex,
          `$1\n  static schedule = "${schedule}";`
        );
      } else {
        throw new Error("Could not find class declaration in agent file");
      }
    }

    // Write file back
    await writeFile(filePath, newContent, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to update agent file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
