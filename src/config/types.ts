/**
 * Configuration type definitions
 * Centralized configuration schema for all agents and plugins
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface AIConfig {
  ollamaUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  ollamaEmbeddingModel: string;
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

export interface SystemConfig {
  dataDir: string;
  webhookPort: number;
  httpIdleTimeout: number;
  externalAgentDir: string;
  userPluginDir: string;
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
  system: SystemConfig;
  eventMonitor: EventMonitorConfig;
  blogBoy: BlogBoyConfig;
  configEditor: ConfigEditorConfig;
  rssToTelegram: RssToTelegramConfig;
  realm: RealmConfig;
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
  | 'ai.ollamaUrl'
  | 'ai.ollamaModel'
  | 'ai.ollamaTimeoutMs'
  | 'ai.ollamaEmbeddingModel'
  | 'gemini'
  | 'gemini.apiKey'
  | 'gemini.model'
  | 'gemini.apiVersion'
  | 'gemini.debug'
  | 'grok'
  | 'grok.apiKey'
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
  | 'pluginDir'
  | 'geminiModel';
