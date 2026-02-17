/**
 * Init Command
 * Interactive onboarding and setup for Ronin
 * Guides users through configuration, feature selection, and first steps
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

interface InitOptions {
  quick?: boolean;
  skipCloudflare?: boolean;
  skipDesktop?: boolean;
}

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  blue: "\x1b[0;34m",
  purple: "\x1b[0;35m",
  cyan: "\x1b[0;36m",
  bold: "\x1b[1m",
};

const c = colors;

export async function initCommand(options: InitOptions = {}): Promise<void> {
  console.log("");
  console.log(`${c.cyan}🥷 Welcome to Ronin - Interactive Setup${c.reset}`);
  console.log("========================================");
  console.log("");
  
  // Check if already initialized
  const configDir = join(homedir(), ".ronin");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    console.log(`${c.green}✓ Created ~/.ronin directory${c.reset}`);
  }

  // Quick mode
  if (options.quick) {
    await quickSetup();
    return;
  }

  // Full interactive setup
  await interactiveSetup(options);
}

async function interactiveSetup(options: InitOptions): Promise<void> {
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer: string) => resolve(answer));
    });
  };

  try {
    // Step 1: AI Provider Selection
    console.log(`${c.purple}📡 STEP 1: AI Provider Configuration${c.reset}`);
    console.log("--------------------------------------");
    console.log("");
    console.log("Ronin works with local AI (Ollama) by default, but can also");
    console.log("use cloud AI providers when you need more power.");
    console.log("");
    
    const hasGrok = await ask("Do you have a Grok API Key? [y/N]: ");
    if (hasGrok.toLowerCase() === "y") {
      const grokKey = await ask("Enter Grok API Key: ");
      if (grokKey) {
        await updateShellConfig("GROK_API_KEY", grokKey);
        console.log(`${c.green}✓ Grok API Key configured${c.reset}`);
      }
    }

    console.log("");

    const hasGemini = await ask("Do you have a Gemini API Key? [y/N]: ");
    if (hasGemini.toLowerCase() === "y") {
      const geminiKey = await ask("Enter Gemini API Key: ");
      if (geminiKey) {
        await updateShellConfig("GEMINI_API_KEY", geminiKey);
        console.log(`${c.green}✓ Gemini API Key configured${c.reset}`);
      }
    }

    // Step 2: Privacy Mode Selection
    console.log("");
    console.log(`${c.purple}🛡️  STEP 2: Privacy & Security Mode${c.reset}`);
    console.log("-------------------------------------");
    console.log("");
    console.log(`${c.cyan}Choose your default AI mode:${c.reset}`);
    console.log("");
    console.log(`${c.green}A) Offline Mode (RECOMMENDED - Most Private)${c.reset}`);
    console.log("   ✓ Ronin will ONLY use local AI (Ollama)");
    console.log("   ✓ Zero data leaves your machine");
    console.log("   ✓ Works without internet");
    console.log("   ✓ You can still use cloud AI when explicitly requested");
    console.log("");
    console.log(`${c.yellow}B) Hybrid Mode${c.reset}`);
    console.log("   ✓ Ronin uses local AI by default");
    console.log("   ✓ Automatically uses cloud for complex tasks");
    console.log("   ✓ Some data may be sent to cloud AI providers");
    console.log("");

    const privacyMode = await ask("Select mode [A/b]: ");
    const offlineMode = privacyMode.toLowerCase() !== "b";
    
    // Save to config
    await saveConfig("desktop.offlineMode", offlineMode);
    
    if (offlineMode) {
      console.log(`${c.green}✓ Offline Mode enabled - Most private configuration${c.reset}`);
    } else {
      console.log(`${c.yellow}✓ Hybrid Mode enabled - May use cloud AI${c.reset}`);
    }

    // Step 3: Desktop Mode (macOS only)
    if (!options.skipDesktop && process.platform === "darwin") {
      console.log("");
      console.log(`${c.purple}🖥️  STEP 3: Desktop Mode (macOS Integration)${c.reset}`);
      console.log("----------------------------------------------");
      console.log("");
      console.log("Desktop Mode integrates Ronin with macOS:");
      console.log("  ✓ Right-click files → 'Send to Ronin' in Finder");
      console.log("  ✓ Menubar icon (🥷) for quick controls");
      console.log("  ✓ Native macOS notifications from agents");
      console.log("  ✓ File watching on Desktop/Downloads folders");
      console.log("");
      console.log(`${c.cyan}What this means:${c.reset}`);
      console.log("  • Agents can access files you send them via right-click");
      console.log("  • Agents can show notifications in Notification Center");
      console.log("  • You can toggle features from the menubar");
      console.log("  • All processing still happens locally on your machine");
      console.log("");

      const desktopMode = await ask("Enable Desktop Mode? [Y/n]: ");
      if (desktopMode.toLowerCase() !== "n") {
        await saveConfig("desktop.enabled", true);
        await saveConfig("desktop.menubar", true);
        console.log(`${c.green}✓ Desktop Mode enabled${c.reset}`);
        console.log(`${c.yellow}ℹ️  Run 'ronin os install mac' after setup to complete installation${c.reset}`);
      }
    }

    // Step 4: Cloudflare Integration
    if (!options.skipCloudflare) {
      console.log("");
      console.log(`${c.purple}☁️  STEP 4: Cloudflare Integration (Optional)${c.reset}`);
      console.log("-----------------------------------------------");
      console.log("");
      console.log("Cloudflare integration lets you:");
      console.log("  ✓ Create secure tunnels to access Ronin remotely");
      console.log("  ✓ Share your dashboard with team members");
      console.log("  ✓ Create webhook endpoints that trigger agents");
      console.log("");
      console.log(`${c.red}🛡️  IMPORTANT - Security Model:${c.reset}`);
      console.log("Ronin uses ZERO-TRUST security with Cloudflare:");
      console.log("  🔒 NOTHING is exposed by default");
      console.log("  🔒 You must explicitly whitelist each route");
      console.log("  🔒 Dangerous paths (/disk, /admin) are always blocked");
      console.log("  🔒 Optional: authentication required, time-based access");
      console.log("  🔒 Complete audit logs of all access attempts");
      console.log("");

      const setupCloudflare = await ask("Set up Cloudflare integration? [y/N]: ");
      if (setupCloudflare.toLowerCase() === "y") {
        await setupCloudflareIntegration();
      }
    }

    // Step 5: Ollama Check
    console.log("");
    console.log(`${c.purple}🤖 STEP 5: Local AI (Ollama)${c.reset}`);
    console.log("-----------------------------");
    console.log("");

    try {
      execSync("which ollama", { stdio: "ignore" });
      console.log(`${c.green}✓ Ollama is installed${c.reset}`);
      
      // Check for models
      try {
        const models = execSync("ollama list", { encoding: "utf-8" });
        if (!models.includes("qwen")) {
          console.log("");
          console.log("Downloading recommended model (qwen3:1.7b)...");
          console.log("This is a lightweight but capable model for local use.");
          execSync("ollama pull qwen3:1.7b", { stdio: "inherit" });
          console.log(`${c.green}✓ Model ready${c.reset}`);
        } else {
          console.log(`${c.green}✓ Qwen model found${c.reset}`);
        }
      } catch {
        console.log(`${c.yellow}⚠️  Could not check models - Ollama may not be running${c.reset}`);
      }
    } catch {
      console.log(`${c.red}✗ Ollama not found${c.reset}`);
      console.log("");
      console.log("Ollama is REQUIRED for Ronin to work.");
      console.log("");
      console.log("Install:");
      if (process.platform === "darwin") {
        console.log("  brew install ollama");
      } else {
        console.log("  curl -fsSL https://ollama.com/install.sh | sh");
      }
      console.log("  https://ollama.com/download");
    }

    // Final Summary
    console.log("");
    console.log(`${c.purple}🎉 Setup Complete!${c.reset}`);
    console.log("==================");
    console.log("");
    console.log(`${c.cyan}Your Ronin configuration:${c.reset}`);
    
    const config = await loadConfig();
    if (config.desktop?.offlineMode) {
      console.log(`  ${c.green}✓${c.reset} Offline Mode (most private)`);
    } else {
      console.log(`  ${c.yellow}✓${c.reset} Hybrid Mode (local + cloud)`);
    }
    
    if (config.desktop?.enabled) {
      console.log(`  ${c.green}✓${c.reset} Desktop Mode (macOS)`);
    }

    console.log("");
    console.log(`${c.cyan}Quick Start:${c.reset}`);
    console.log("  ronin start              # Start Ronin with all agents");
    console.log("  ronin create agent       # Create your first agent");
    console.log("  ronin ask                # Ask a question (local AI)");
    console.log("");
    console.log(`${c.cyan}Documentation:${c.reset}`);
    console.log("  ronin docs               # View all documentation");
    console.log("  ronin docs CLI           # CLI reference");
    console.log("  ronin docs DESKTOP_MODE  # Desktop Mode guide");
    console.log("");
    console.log(`${c.green}Welcome to Ronin! 🥷${c.reset}`);
    console.log("Your local-first AI agent framework is ready.");
    console.log("");

    // Ask to start
    const startNow = await ask("Start Ronin now? [y/N]: ");
    if (startNow.toLowerCase() === "y") {
      console.log("");
      console.log(`${c.cyan}Starting Ronin...${c.reset}`);
      console.log("");
      
      // This would actually start Ronin
      console.log("(In real implementation, this would run: ronin start)");
    }

  } finally {
    rl.close();
  }
}

async function quickSetup(): Promise<void> {
  console.log(`${c.cyan}Quick Setup Mode${c.reset}`);
  console.log("Using recommended defaults...");
  console.log("");

  // Default: Offline mode, no desktop, no cloudflare
  await saveConfig("desktop.offlineMode", true);
  
  console.log(`${c.green}✓ Offline Mode enabled (most private)${c.reset}`);
  console.log(`${c.green}✓ Quick setup complete!${c.reset}`);
  console.log("");
  console.log("Run 'ronin init' for full setup with more options.");
  console.log("");
  console.log(`${c.cyan}Next steps:${c.reset}`);
  console.log("  ronin start              # Start Ronin");
  console.log("  ronin create agent       # Create an agent");
}

async function setupCloudflareIntegration(): Promise<void> {
  console.log("");
  console.log(`${c.cyan}Setting up Cloudflare integration...${c.reset}`);
  console.log("");

  // Check/install Wrangler
  try {
    execSync("which wrangler", { stdio: "ignore" });
    console.log(`${c.green}✓ Wrangler already installed${c.reset}`);
  } catch {
    console.log("Installing Wrangler CLI...");
    try {
      execSync("npm install -g wrangler", { stdio: "inherit" });
      console.log(`${c.green}✓ Wrangler installed${c.reset}`);
    } catch (error) {
      console.log(`${c.red}✗ Failed to install Wrangler${c.reset}`);
      console.log("Install manually: npm install -g wrangler");
      return;
    }
  }

  // Check/install cloudflared
  try {
    execSync("which cloudflared", { stdio: "ignore" });
    console.log(`${c.green}✓ cloudflared already installed${c.reset}`);
  } catch {
    console.log("Installing cloudflared daemon...");
    console.log("Please install manually from: https://github.com/cloudflare/cloudflared/releases");
  }

  console.log("");
  console.log("You'll now authenticate with Cloudflare via your browser.");
  console.log("Press Enter to continue...");
  
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  await new Promise((resolve) => rl.question("", resolve));
  rl.close();

  try {
    execSync("wrangler login", { stdio: "inherit" });
    console.log(`${c.green}✓ Cloudflare authentication complete!${c.reset}`);
    console.log("");
    console.log(`${c.cyan}Next steps:${c.reset}`);
    console.log("  ronin cloudflare route init       # Initialize route policy");
    console.log("  ronin cloudflare route add /api   # Add a route to expose");
    console.log("  ronin cloudflare tunnel create    # Create secure tunnel");
  } catch {
    console.log(`${c.red}✗ Authentication failed${c.reset}`);
  }
}

async function updateShellConfig(key: string, value: string): Promise<void> {
  const shellRc = process.env.SHELL?.includes("zsh") 
    ? join(homedir(), ".zshrc")
    : join(homedir(), ".bashrc");

  const exportLine = `export ${key}="${value}"`;
  
  try {
    const content = readFileSync(shellRc, "utf-8");
    if (!content.includes(key)) {
      writeFileSync(shellRc, content + `\n# Ronin\n${exportLine}\n`);
    }
  } catch {
    writeFileSync(shellRc, `# Ronin\n${exportLine}\n`);
  }
}

async function saveConfig(key: string, value: any): Promise<void> {
  const configPath = join(homedir(), ".ronin", "config.json");
  
  let config: any = {};
  try {
    const content = readFileSync(configPath, "utf-8");
    config = JSON.parse(content);
  } catch {
    // Config doesn't exist yet
  }

  // Set nested key (e.g., "desktop.offlineMode")
  const keys = key.split(".");
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;

  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function loadConfig(): Promise<any> {
  const configPath = join(homedir(), ".ronin", "config.json");
  
  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
