/**
 * Configuration type definitions
 * Centralized configuration schema for all agents and plugins
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export type AIProviderType = "ollama" | "openai" | "gemini" | "grok";

export interface AIModelSlots {
  default: string;
  fast: string;
  smart: string;
  embedding: string;
}

export interface AIFallbackConfig {
  enabled: boolean;
  chain: AIProviderType[];
}

export interface OpenAICompatConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AIConfig {
  provider: AIProviderType;
  temperature: number;
  ollamaUrl: string;
  ollamaModel: string;
  /** When set, the "smart" model tier uses this URL (e.g. Ollama Cloud) instead of ollamaUrl. */
  ollamaSmartUrl?: string;
  ollamaTimeoutMs: number;
  ollamaEmbeddingModel: string;
  models: AIModelSlots;
  fallback: AIFallbackConfig;
  openai: OpenAICompatConfig;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  apiVersion: string;
  debug: boolean;
}

export interface GrokConfig {
  apiKey: string;
}

export interface BraveSearchConfig {
  apiKey: string;
}

export interface SystemConfig {
  dataDir: string;
  webhookPort: number;
  httpIdleTimeout: number;
  externalAgentDir: string;
  userPluginDir: string;
  /** User skills directory (AgentSkills). Defaults to ~/.ronin/skills */
  skillsDir?: string;
}

export interface CLIOptions {
  qwen: {
    model: string;
    timeout: number;
  };
  cursor: {
    timeout: number;
  };
  opencode: {
    timeout: number;
  };
  gemini: {
    model: string;
    timeout: number;
  };
}

export interface EventMonitorSampling {
  enabled: boolean;
  thresholdPerHour: number;
  rate: number;
}

export interface EventMonitorConfig {
  enabled: boolean;
  retentionHours: number;
  maxPayloadSize: number;
  autoRefreshSeconds: number;
  pageSize: number;
  sampling: EventMonitorSampling;
}

export interface DiscordConfig {
  enabled: boolean;
  botToken: string;
  channelIds: string[];
  clientId: string;
}

export interface BlogBoyConfig {
  aiTimeoutMs: number;
}

export interface ConfigEditorConfig {
  password: string;
}

export interface RssToTelegramConfig {
  enabled: boolean;
}

export interface RealmConfig {
  url: string;
  callsign: string;
  token: string;
  localPort: number;
}

export interface DesktopFeaturesConfig {
  notifications: boolean;
  clipboard: boolean;
  shortcuts: boolean;
  fileWatching: boolean;
}

export interface DesktopBridgeConfig {
  port: number;
  host: string;
}

export interface MenubarRoutesConfig {
  enabled: boolean;
  /** When set, only these paths are listable (exact or prefix match). Overrides include/exclude patterns. */
  allowedPaths?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  maxItems?: number;
}

export interface DesktopConfig {
  enabled: boolean;
  features: DesktopFeaturesConfig;
  folders: string[];
  bridge: DesktopBridgeConfig;
  menubar: boolean;
  menubarRoutes?: MenubarRoutesConfig;
}

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export interface STTConfig {
  backend: "apple" | "whisper" | "deepgram";
  whisperModelPath: string;
  whisperBinary: string;
  deepgramApiKey: string;
}

export interface SpeechConfig {
  stt: STTConfig;
}

export interface NotificationsConfig {
  preferredChat: 'telegram' | 'discord' | 'auto';
  timeoutSeconds: number;
}

export interface FullConfig {
  configVersion: string;
  defaultCLI: string;
  defaultAppsDirectory: string;
  apps: Record<string, string>;
  cliOptions: CLIOptions;
  telegram: TelegramConfig;
  discord: DiscordConfig;
  ai: AIConfig;
  gemini: GeminiConfig;
  grok: GrokConfig;
  braveSearch: BraveSearchConfig;
  system: SystemConfig;
  eventMonitor: EventMonitorConfig;
  blogBoy: BlogBoyConfig;
  configEditor: ConfigEditorConfig;
  rssToTelegram: RssToTelegramConfig;
  realm: RealmConfig;
  desktop: DesktopConfig;
  mcp: MCPConfig;
  speech: SpeechConfig;
  notifications: NotificationsConfig;
  pluginDir: string;
  geminiModel: string;
}

export type ConfigPath = 
  | 'configVersion'
  | 'defaultCLI'
  | 'defaultAppsDirectory'
  | 'apps'
  | 'cliOptions'
  | 'cliOptions.qwen'
  | 'cliOptions.qwen.model'
  | 'cliOptions.qwen.timeout'
  | 'cliOptions.cursor'
  | 'cliOptions.cursor.timeout'
  | 'cliOptions.opencode'
  | 'cliOptions.opencode.timeout'
  | 'cliOptions.gemini'
  | 'cliOptions.gemini.model'
  | 'cliOptions.gemini.timeout'
  | 'telegram'
  | 'telegram.botToken'
  | 'telegram.chatId'
  | 'discord'
  | 'discord.enabled'
  | 'discord.botToken'
  | 'discord.channelIds'
  | 'discord.clientId'
  | 'ai'
  | 'ai.provider'
  | 'ai.temperature'
  | 'ai.ollamaUrl'
  | 'ai.ollamaModel'
  | 'ai.ollamaSmartUrl'
  | 'ai.ollamaTimeoutMs'
  | 'ai.ollamaEmbeddingModel'
  | 'ai.models'
  | 'ai.models.default'
  | 'ai.models.fast'
  | 'ai.models.smart'
  | 'ai.models.embedding'
  | 'ai.fallback'
  | 'ai.fallback.enabled'
  | 'ai.fallback.chain'
  | 'ai.openai'
  | 'ai.openai.apiKey'
  | 'ai.openai.baseUrl'
  | 'ai.openai.model'
  | 'gemini'
  | 'gemini.apiKey'
  | 'gemini.model'
  | 'gemini.apiVersion'
  | 'gemini.debug'
  | 'grok'
  | 'grok.apiKey'
  | 'braveSearch'
  | 'braveSearch.apiKey'
  | 'system'
  | 'system.dataDir'
  | 'system.webhookPort'
  | 'system.httpIdleTimeout'
  | 'system.externalAgentDir'
  | 'system.userPluginDir'
  | 'eventMonitor'
  | 'eventMonitor.enabled'
  | 'eventMonitor.retentionHours'
  | 'eventMonitor.maxPayloadSize'
  | 'eventMonitor.autoRefreshSeconds'
  | 'eventMonitor.pageSize'
  | 'eventMonitor.sampling'
  | 'eventMonitor.sampling.enabled'
  | 'eventMonitor.sampling.thresholdPerHour'
  | 'eventMonitor.sampling.rate'
  | 'blogBoy'
  | 'blogBoy.aiTimeoutMs'
  | 'configEditor'
  | 'configEditor.password'
  | 'rssToTelegram'
  | 'rssToTelegram.enabled'
  | 'realm'
  | 'realm.url'
  | 'realm.callsign'
  | 'realm.token'
  | 'realm.localPort'
  | 'desktop'
  | 'desktop.enabled'
  | 'desktop.features'
  | 'desktop.features.notifications'
  | 'desktop.features.clipboard'
  | 'desktop.features.shortcuts'
  | 'desktop.features.fileWatching'
  | 'desktop.folders'
  | 'desktop.bridge'
  | 'desktop.bridge.port'
  | 'desktop.bridge.host'
  | 'desktop.menubar'
  | 'desktop.menubarRoutes'
  | 'desktop.menubarRoutes.allowedPaths'
  | 'notifications'
  | 'notifications.preferredChat'
  | 'notifications.timeoutSeconds'
  | 'pluginDir'
  | 'geminiModel';
