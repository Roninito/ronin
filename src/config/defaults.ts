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
      model: "granite3.2-16k",
      timeout: 60000,
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
    provider: "ollama",
    temperature: 0.7,
    // Phase 1: Legacy Ollama support (deprecated but supported for backward compatibility)
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "granite3.2-16k",
    ollamaSmartUrl: "",
    ollamaSmartApiKey: "",
    ollamaTimeoutMs: 60000,
    ollamaEmbeddingModel: "nomic-embed-text",
    models: {
      default: "granite3.2-16k",
      fast: "granite3.2-16k",
      smart: "kimi-k2.5",
      embedding: "nomic-embed-text",
    },
    fallback: {
      enabled: false,
      chain: [],
    },
    // Phase 1: New unified provider configuration
    providers: {
      ollama: {
        enabled: true,
        baseUrl: "http://localhost:11434",
        model: "granite3.2-16k",
        temperature: 0.7,
        timeout: 60000,
      },
      anthropic: {
        enabled: false,
        apiKey: "", // Set via ANTHROPIC_API_KEY env var
        model: "claude-3-5-sonnet-20241022",
        timeout: 30000,
      },
      lmstudio: {
        enabled: false,
        baseUrl: "http://localhost:1234",
        cloudUrl: "", // For cloud deployments
        model: "local-model",
        timeout: 30000,
      },
    },
    openai: {
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    },
    useSmartForTools: true,
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

  braveSearch: {
    apiKey: "",
  },
  
  system: {
    dataDir: join(homedir(), ".ronin", "data"),
    webhookPort: 3000,
    httpIdleTimeout: 60,
    externalAgentDir: join(homedir(), ".ronin", "agents"),
    userPluginDir: join(homedir(), ".ronin", "plugins"),
    skillsDir: join(homedir(), ".ronin", "skills"),
    logRetentionRuns: 2,
    logToFile: true,
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

  desktop: {
    enabled: true,
    features: {
      notifications: true,
      clipboard: false,
      shortcuts: true,
      fileWatching: true,
    },
    folders: ["~/Desktop", "~/Downloads"],
    bridge: {
      port: 17341,
      host: "localhost",
    },
    menubar: true,
  },

  mcp: {
    servers: {},
  },

  speech: {
    stt: {
      backend: "apple",
      whisperModelPath: "",
      whisperBinary: "whisper-cli",
      deepgramApiKey: "",
    },
    tts: {
      piperModelPath: "",
      piperBinary: "piper",
    },
  },

  notifications: {
    preferredChat: "auto",
    timeoutSeconds: 30,
  },

  mesh: {
    enabled: false,
    mode: "local-only",
    localMesh: {
      enabled: true,
      groupId: "ronin-mesh",
      discoveryPort: 29716,
      dataPort: 42671,
    },
    privateNetwork: {
      enabled: false,
      sharedKey: "",
      networkName: "",
    },
    wideArea: {
      enabled: false,
      discoveryScope: "link",
    },
    instance: {
      name: "ronin-instance",
      description: "",
    },
  },

  pluginDir: join(process.cwd(), "plugins"),
  geminiModel: "gemini-3-pro-preview",
  alpaca: {
    apiKey: "",
    secretKey: "",
    mode: "paper",
  },
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
  "ai.provider": "RONIN_AI_PROVIDER",
  "ai.temperature": "RONIN_AI_TEMPERATURE",
  "ai.ollamaUrl": "OLLAMA_URL",
  "ai.ollamaModel": "OLLAMA_MODEL",
  "ai.ollamaSmartUrl": "OLLAMA_SMART_URL",
  "ai.ollamaSmartApiKey": "OLLAMA_API_KEY",
  "ai.ollamaTimeoutMs": "OLLAMA_TIMEOUT_MS",
  "ai.ollamaEmbeddingModel": "OLLAMA_EMBEDDING_MODEL",
  "ai.openai.apiKey": "OPENAI_API_KEY",
  "ai.openai.baseUrl": "OPENAI_BASE_URL",
  "ai.openai.model": "OPENAI_MODEL",
  "gemini.apiKey": "GEMINI_API_KEY",
  "gemini.model": "GEMINI_MODEL",
  "gemini.apiVersion": "GEMINI_API_VERSION",
  "gemini.debug": "DEBUG_GEMINI",
  "grok.apiKey": "GROK_API_KEY",
  "braveSearch.apiKey": "BRAVE_API_KEY",
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
  "speech.stt.backend": "STT_BACKEND",
  "speech.stt.deepgramApiKey": "DEEPGRAM_API_KEY",
  "speech.stt.whisperModelPath": "WHISPER_MODEL_PATH",
  "speech.stt.whisperBinary": "WHISPER_BINARY",
  "speech.tts.piperModelPath": "PIPER_MODEL_PATH",
  "speech.tts.piperBinary": "PIPER_BINARY",
};
