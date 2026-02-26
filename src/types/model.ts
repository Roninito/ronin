/**
 * Model selection and registry types
 */

/** Rate limit configuration */
export interface RateLimit {
  requestsPerMinute: number;
  tokensPerMinute: number;
}

/** Model cost and usage limits */
export interface ModelLimits {
  /** Cost per million input tokens */
  costPerMTok: number;
  /** Cost per million output tokens */
  costPerOTok: number;
  /** Maximum daily spend in USD */
  maxDailySpend: number;
  /** Maximum monthly spend in USD */
  maxMonthlySpend: number;
  /** Maximum concurrent requests */
  maxConcurrent: number;
  /** Maximum tokens per request */
  maxTokensPerRequest: number;
  /** Rate limit configuration */
  rateLimit: RateLimit;
}

/** Model configuration */
export interface ModelConfig {
  /** Provider this model belongs to */
  provider: string;
  /** Provider's model ID/name */
  modelId: string;
  /** Unique nametag for selection (e.g., "claude-haiku") */
  nametag: string;
  /** Human-readable display name */
  displayName: string;
  /** Description of the model */
  description: string;
  /** Tags for selection and filtering (e.g., ["fast", "cheap", "reliable"]) */
  tags: string[];
  /** Whether this is the default model */
  isDefault: boolean;
  /** Cost and usage limits */
  limits: ModelLimits;
  /** Default configuration options */
  config: Record<string, unknown>;
}

/** Provider configuration */
export interface ProviderConfig {
  /** Type of provider: "remote" or "local" */
  type: "remote" | "local";
  /** Base URL for API calls */
  baseUrl: string;
  /** Environment variable name for API key (remote only) */
  apiKeyEnv?: string;
  /** Description of the provider */
  description: string;
  /** Default configuration options */
  defaults: Record<string, unknown>;
}

/** Daily usage statistics */
export interface DailyUsageStats {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requests: number;
  avgLatency: number;
}

/** Model usage tracking */
export interface ModelUsage {
  today: DailyUsageStats;
  thisMonth: DailyUsageStats;
}

/** Complete model registry */
export interface ModelRegistry {
  /** Default model nametag */
  default: string;
  /** Provider configurations */
  providers: Record<string, ProviderConfig>;
  /** Available models */
  models: Record<string, ModelConfig>;
  /** Usage statistics per model */
  usage: Record<string, ModelUsage>;
}

/** Result of constraint checking */
export interface ConstraintCheckResult {
  allowed: boolean;
  reason?: string;
}

/** Result of model auto-selection */
export interface ModelSelectionOptions {
  /** Filter by these tags (all must match) */
  tags?: string[];
  /** Maximum acceptable cost per token */
  maxCost?: number;
  /** Maximum acceptable latency */
  maxLatency?: number;
  /** Estimated tokens for this request */
  estimatedTokens?: number;
}
