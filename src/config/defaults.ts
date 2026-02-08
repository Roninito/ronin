/**
 * Default configuration values
 * All defaults are defined here for consistency
 */

import { homedir } from "os";
import { join } from "path";
import type { FullConfig } from "./types.js";

export const DEFAULT_CONFIG: FullConfig = {
  configVersion: "1.0.0",
  defaultCLI: "qwen",
  defaultAppsDirectory: join(homedir(), ".ronin", "apps"),
  apps: {},
  
  cliOptions: {
    qwen: {
      model: "qwen3:1.7b",
      timeout: 300000,
    },
    cursor: {
      timeout: 60000,
    },
    opencode: {
      timeout: 120000,
    },
    gemini: {
      model: "gemini-pro",
      timeout: 60000,
    },
  },
  
  telegram: {
    botToken: "",
    chatId: "",
  },
  
  discord: {
    enabled: false,
    botToken: "",
    channelIds: [],
    clientId: "",
  },
  
  ai: {
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "qwen3:4b",
    ollamaTimeoutMs: 300000,
    ollamaEmbeddingModel: "nomic-embed-text",
  },
  
  gemini: {
    apiKey: "",
    model: "gemini-pro",
    apiVersion: "v1beta",
    debug: false,
  },
  
  grok: {
    apiKey: "",
  },
  
  system: {
    dataDir: join(homedir(), ".ronin", "data"),
    webhookPort: 3000,
    httpIdleTimeout: 60,
    externalAgentDir: join(homedir(), ".ronin", "agents"),
    userPluginDir: join(homedir(), ".ronin", "plugins"),
  },
  
  eventMonitor: {
    enabled: true,
    retentionHours: 24,
    maxPayloadSize: 500,
    autoRefreshSeconds: 30,
    pageSize: 50,
    sampling: {
      enabled: true,
      thresholdPerHour: 100,
      rate: 10,
    },
  },
  
  blogBoy: {
    aiTimeoutMs: 300000,
  },
  
  configEditor: {
    password: "roninpass",
  },
  
  rssToTelegram: {
    enabled: false,
  },
  
  realm: {
    url: "",
    callsign: "",
    token: "",
    localPort: 4000,
  },
  
  pluginDir: join(process.cwd(), "plugins"),
  geminiModel: "gemini-3-pro-preview",
};

/**
 * Environment variable mappings
 * Maps config paths to environment variable names
 */
export const ENV_MAPPINGS: Record<string, string> = {
  "telegram.botToken": "TELEGRAM_BOT_TOKEN",
  "telegram.chatId": "TELEGRAM_CHAT_ID",
  "discord.botToken": "DISCORD_BOT_TOKEN",
  "discord.channelIds": "DISCORD_CHANNEL_IDS",
  "ai.ollamaUrl": "OLLAMA_URL",
  "ai.ollamaModel": "OLLAMA_MODEL",
  "ai.ollamaTimeoutMs": "OLLAMA_TIMEOUT_MS",
  "ai.ollamaEmbeddingModel": "OLLAMA_EMBEDDING_MODEL",
  "gemini.apiKey": "GEMINI_API_KEY",
  "gemini.model": "GEMINI_MODEL",
  "gemini.apiVersion": "GEMINI_API_VERSION",
  "gemini.debug": "DEBUG_GEMINI",
  "grok.apiKey": "GROK_API_KEY",
  "system.dataDir": "RONIN_DATA_DIR",
  "system.webhookPort": "WEBHOOK_PORT",
  "system.httpIdleTimeout": "HTTP_IDLE_TIMEOUT",
  "system.externalAgentDir": "RONIN_EXTERNAL_AGENT_DIR",
  "blogBoy.aiTimeoutMs": "BLOG_BOY_AI_TIMEOUT_MS",
  "configEditor.password": "CONFIG_EDITOR_PASSWORD",
  "realm.url": "REALM_URL",
  "realm.callsign": "REALM_CALLSIGN",
  "realm.token": "REALM_TOKEN",
  "realm.localPort": "REALM_LOCAL_PORT",
};
