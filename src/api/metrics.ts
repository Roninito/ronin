/**
 * Metrics — Usage tracking for AI providers and models
 */

export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface ModelMetrics {
  modelId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokensUsed: number;
  totalCost: number;
  averageResponseTime: number;
  lastUsed: number;
  history: MetricPoint[];
}

export interface ProviderMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokensUsed: number;
  totalCost: number;
  averageResponseTime: number;
  modelsMetrics: Map<string, ModelMetrics>;
  lastUsed: number;
}

export class MetricsCollector {
  private metrics: Map<string, ProviderMetrics>;
  private historyLimit: number;

  constructor(historyLimit: number = 1000) {
    this.metrics = new Map();
    this.historyLimit = historyLimit;
  }

  /**
   * Record a successful completion
   */
  recordCompletion(
    provider: string,
    model: string,
    tokensUsed: number,
    responseTime: number,
    cost: number = 0,
  ): void {
    const providerMetrics = this.getOrCreateProvider(provider);
    const modelMetrics = this.getOrCreateModel(providerMetrics, model);

    providerMetrics.totalRequests++;
    providerMetrics.successfulRequests++;
    providerMetrics.totalTokensUsed += tokensUsed;
    providerMetrics.totalCost += cost;
    providerMetrics.averageResponseTime =
      (providerMetrics.averageResponseTime * (providerMetrics.successfulRequests - 1) +
        responseTime) /
      providerMetrics.successfulRequests;
    providerMetrics.lastUsed = Date.now();

    modelMetrics.totalRequests++;
    modelMetrics.successfulRequests++;
    modelMetrics.totalTokensUsed += tokensUsed;
    modelMetrics.totalCost += cost;
    modelMetrics.averageResponseTime =
      (modelMetrics.averageResponseTime * (modelMetrics.successfulRequests - 1) +
        responseTime) /
      modelMetrics.successfulRequests;
    modelMetrics.lastUsed = Date.now();

    // Add to history
    this.addToHistory(modelMetrics, responseTime);
  }

  /**
   * Record a failed completion
   */
  recordFailure(provider: string, model: string): void {
    const providerMetrics = this.getOrCreateProvider(provider);
    const modelMetrics = this.getOrCreateModel(providerMetrics, model);

    providerMetrics.totalRequests++;
    providerMetrics.failedRequests++;
    providerMetrics.lastUsed = Date.now();

    modelMetrics.totalRequests++;
    modelMetrics.failedRequests++;
    modelMetrics.lastUsed = Date.now();
  }

  /**
   * Get metrics for a provider
   */
  getProviderMetrics(provider: string): ProviderMetrics | undefined {
    return this.metrics.get(provider);
  }

  /**
   * Get metrics for a model
   */
  getModelMetrics(provider: string, model: string): ModelMetrics | undefined {
    const providerMetrics = this.metrics.get(provider);
    return providerMetrics?.modelsMetrics.get(model);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): ProviderMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Reset metrics for a provider or specific model
   */
  reset(provider?: string, model?: string): void {
    if (!provider) {
      this.metrics.clear();
      return;
    }

    const providerMetrics = this.metrics.get(provider);
    if (!providerMetrics) return;

    if (!model) {
      this.metrics.delete(provider);
    } else {
      providerMetrics.modelsMetrics.delete(model);
    }
  }

  /**
   * Get success rate for a provider
   */
  getSuccessRate(provider: string): number {
    const metrics = this.metrics.get(provider);
    if (!metrics || metrics.totalRequests === 0) return 0;
    return metrics.successfulRequests / metrics.totalRequests;
  }

  /**
   * Export metrics as JSON
   */
  export(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [provider, metrics] of this.metrics) {
      result[provider] = {
        totalRequests: metrics.totalRequests,
        successfulRequests: metrics.successfulRequests,
        failedRequests: metrics.failedRequests,
        totalTokensUsed: metrics.totalTokensUsed,
        totalCost: metrics.totalCost,
        averageResponseTime: metrics.averageResponseTime,
        lastUsed: metrics.lastUsed,
        models: Array.from(metrics.modelsMetrics.entries()).map(([id, m]) => ({
          id,
          totalRequests: m.totalRequests,
          successfulRequests: m.successfulRequests,
          failedRequests: m.failedRequests,
          totalTokensUsed: m.totalTokensUsed,
          totalCost: m.totalCost,
          averageResponseTime: m.averageResponseTime,
          lastUsed: m.lastUsed,
        })),
      };
    }
    return result;
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private getOrCreateProvider(provider: string): ProviderMetrics {
    let metrics = this.metrics.get(provider);
    if (!metrics) {
      metrics = {
        provider,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalTokensUsed: 0,
        totalCost: 0,
        averageResponseTime: 0,
        modelsMetrics: new Map(),
        lastUsed: 0,
      };
      this.metrics.set(provider, metrics);
    }
    return metrics;
  }

  private getOrCreateModel(providerMetrics: ProviderMetrics, model: string): ModelMetrics {
    let modelMetrics = providerMetrics.modelsMetrics.get(model);
    if (!modelMetrics) {
      modelMetrics = {
        modelId: model,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalTokensUsed: 0,
        totalCost: 0,
        averageResponseTime: 0,
        lastUsed: 0,
        history: [],
      };
      providerMetrics.modelsMetrics.set(model, modelMetrics);
    }
    return modelMetrics;
  }

  private addToHistory(metrics: ModelMetrics, responseTime: number): void {
    metrics.history.push({
      timestamp: Date.now(),
      value: responseTime,
    });

    if (metrics.history.length > this.historyLimit) {
      metrics.history = metrics.history.slice(-this.historyLimit);
    }
  }
}
