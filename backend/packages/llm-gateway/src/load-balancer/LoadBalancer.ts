import {
  ILLMProvider,
  LoadBalancerConfig,
  CompletionOptions,
  CompletionResponse,
  StreamOptions,
  Token,
  ProviderHealth,
  LLMProvider,
  LLMError,
  ERROR_CODES,
  retry,
} from '@cortex/shared';
import { createLogger } from '@cortex/shared';
import { ProviderFactory } from './ProviderFactory';

const logger = createLogger('LoadBalancer');

/**
 * Circuit breaker state for each provider
 */
class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private isOpen: boolean = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly resetTimeout: number
  ) {}

  recordSuccess(): void {
    this.failures = 0;
    this.isOpen = false;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.isOpen = true;
      logger.warn('Circuit breaker opened', {
        failures: this.failures,
        threshold: this.failureThreshold,
      });
    }
  }

  canAttempt(): boolean {
    if (!this.isOpen) {
      return true;
    }

    // Check if reset timeout has passed
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure >= this.resetTimeout) {
      logger.info('Circuit breaker reset timeout passed, allowing attempt');
      this.isOpen = false;
      this.failures = 0;
      return true;
    }

    return false;
  }

  getState(): { isOpen: boolean; failures: number } {
    return {
      isOpen: this.isOpen,
      failures: this.failures,
    };
  }
}

/**
 * Load balancer for distributing requests across multiple LLM providers
 * Supports multiple strategies, failover, and circuit breaker pattern
 */
export class LoadBalancer {
  private providers: ILLMProvider[] = [];
  private currentIndex: number = 0;
  private config: LoadBalancerConfig;
  private circuitBreakers: Map<LLMProvider, CircuitBreaker> = new Map();
  private providerHealth: Map<LLMProvider, ProviderHealth> = new Map();
  private providerLatencies: Map<LLMProvider, number[]> = new Map();

  constructor(config: LoadBalancerConfig) {
    this.config = config;
    logger.info('Load balancer initialized', {
      strategy: config.strategy,
      providerCount: config.providers.length,
      fallbackEnabled: config.fallbackEnabled,
    });
  }

  /**
   * Initialize all providers
   */
  async initialize(): Promise<void> {
    logger.info('Initializing providers...');

    for (const providerConfig of this.config.providers) {
      try {
        const providerType = providerConfig.provider as LLMProvider;
        const provider = ProviderFactory.createProvider(providerType);
        await provider.initialize(providerConfig);
        this.providers.push(provider);

        // Initialize circuit breaker if configured
        if (this.config.circuitBreaker) {
          this.circuitBreakers.set(
            provider.name,
            new CircuitBreaker(
              this.config.circuitBreaker.failureThreshold,
              this.config.circuitBreaker.resetTimeout
            )
          );
        }

        // Initialize health tracking
        this.providerHealth.set(provider.name, {
          provider: provider.name,
          isHealthy: true,
          lastChecked: new Date(),
        });

        // Initialize latency tracking
        this.providerLatencies.set(provider.name, []);

        logger.info(`Provider initialized: ${provider.name}`);
      } catch (error: any) {
        logger.error(`Failed to initialize provider: ${providerConfig.provider}`, {
          error: error.message,
        });
      }
    }

    if (this.providers.length === 0) {
      throw new Error('No providers were successfully initialized');
    }

    logger.info(`Load balancer ready with ${this.providers.length} providers`);
  }

  /**
   * Complete a prompt using the load balancing strategy
   */
  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    const provider = this.selectProvider();

    if (!provider) {
      throw new LLMError(
        ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
        'No healthy providers available'
      );
    }

    try {
      const startTime = Date.now();

      const response = await this.executeWithRetry(
        () => provider.complete(prompt, options),
        provider
      );

      const latency = Date.now() - startTime;
      this.recordSuccess(provider, latency);

      return response;
    } catch (error: any) {
      this.recordFailure(provider);

      // Try fallback if enabled
      if (this.config.fallbackEnabled) {
        logger.warn(`Provider ${provider.name} failed, trying fallback`);
        return await this.completeFallback(prompt, options, provider);
      }

      throw error;
    }
  }

  /**
   * Stream completion using the load balancing strategy
   */
  async *stream(prompt: string, options: StreamOptions): AsyncGenerator<Token> {
    const provider = this.selectProvider();

    if (!provider) {
      throw new LLMError(
        ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
        'No healthy providers available'
      );
    }

    try {
      const startTime = Date.now();

      for await (const token of provider.stream(prompt, options)) {
        yield token;
      }

      const latency = Date.now() - startTime;
      this.recordSuccess(provider, latency);
    } catch (error: any) {
      this.recordFailure(provider);
      throw error;
    }
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    provider: ILLMProvider
  ): Promise<T> {
    return await retry(fn, {
      maxAttempts: this.config.retryAttempts,
      delay: this.config.retryDelay,
      onRetry: (attempt, error) => {
        logger.warn(`Retry attempt ${attempt} for provider ${provider.name}`, {
          error: error.message,
        });
      },
    });
  }

  /**
   * Try fallback providers
   */
  private async completeFallback(
    prompt: string,
    options: CompletionOptions,
    failedProvider: ILLMProvider
  ): Promise<CompletionResponse> {
    const availableProviders = this.providers.filter((p) => p !== failedProvider);

    for (const provider of availableProviders) {
      if (!this.canUseProvider(provider)) {
        continue;
      }

      try {
        logger.info(`Attempting fallback with provider: ${provider.name}`);
        const response = await provider.complete(prompt, options);
        this.recordSuccess(provider, 0);
        return response;
      } catch (error: any) {
        logger.warn(`Fallback provider ${provider.name} also failed`);
        this.recordFailure(provider);
      }
    }

    throw new LLMError(
      ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
      'All providers failed including fallbacks'
    );
  }

  /**
   * Select a provider based on the configured strategy
   */
  private selectProvider(): ILLMProvider | null {
    const availableProviders = this.providers.filter((p) => this.canUseProvider(p));

    if (availableProviders.length === 0) {
      logger.error('No available providers');
      return null;
    }

    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(availableProviders);
      case 'least-latency':
        return this.selectLeastLatency(availableProviders);
      case 'least-cost':
        return this.selectLeastCost(availableProviders);
      case 'priority':
        return this.selectPriority(availableProviders);
      default:
        return availableProviders[0];
    }
  }

  private selectRoundRobin(providers: ILLMProvider[]): ILLMProvider {
    const provider = providers[this.currentIndex % providers.length];
    this.currentIndex++;
    return provider;
  }

  private selectLeastLatency(providers: ILLMProvider[]): ILLMProvider {
    let bestProvider = providers[0];
    let lowestLatency = this.getAverageLatency(bestProvider);

    for (const provider of providers) {
      const avgLatency = this.getAverageLatency(provider);
      if (avgLatency < lowestLatency) {
        lowestLatency = avgLatency;
        bestProvider = provider;
      }
    }

    return bestProvider;
  }

  private selectLeastCost(providers: ILLMProvider[]): ILLMProvider {
    let bestProvider = providers[0];
    let lowestCost = bestProvider.costPerToken.input + bestProvider.costPerToken.output;

    for (const provider of providers) {
      const cost = provider.costPerToken.input + provider.costPerToken.output;
      if (cost < lowestCost) {
        lowestCost = cost;
        bestProvider = provider;
      }
    }

    return bestProvider;
  }

  private selectPriority(providers: ILLMProvider[]): ILLMProvider {
    // Providers are already in priority order from config
    return providers[0];
  }

  private canUseProvider(provider: ILLMProvider): boolean {
    const health = this.providerHealth.get(provider.name);
    if (!health?.isHealthy) {
      return false;
    }

    if (this.config.circuitBreaker) {
      const breaker = this.circuitBreakers.get(provider.name);
      if (breaker && !breaker.canAttempt()) {
        return false;
      }
    }

    return true;
  }

  private recordSuccess(provider: ILLMProvider, latency: number): void {
    // Update circuit breaker
    const breaker = this.circuitBreakers.get(provider.name);
    if (breaker) {
      breaker.recordSuccess();
    }

    // Update health
    const health = this.providerHealth.get(provider.name);
    if (health) {
      health.isHealthy = true;
      health.lastChecked = new Date();
      health.latency = latency;
    }

    // Track latency
    const latencies = this.providerLatencies.get(provider.name) || [];
    latencies.push(latency);
    // Keep only last 100 latencies
    if (latencies.length > 100) {
      latencies.shift();
    }
    this.providerLatencies.set(provider.name, latencies);
  }

  private recordFailure(provider: ILLMProvider): void {
    // Update circuit breaker
    const breaker = this.circuitBreakers.get(provider.name);
    if (breaker) {
      breaker.recordFailure();
    }

    // Update health
    const health = this.providerHealth.get(provider.name);
    if (health) {
      health.isHealthy = false;
      health.lastChecked = new Date();
    }
  }

  private getAverageLatency(provider: ILLMProvider): number {
    const latencies = this.providerLatencies.get(provider.name) || [];
    if (latencies.length === 0) {
      return Infinity; // No data, deprioritize
    }
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  /**
   * Get health status of all providers
   */
  getHealthStatus(): ProviderHealth[] {
    return Array.from(this.providerHealth.values()).map((health) => {
      const breaker = this.circuitBreakers.get(health.provider);
      return {
        ...health,
        circuitBreakerOpen: breaker?.getState().isOpen,
      };
    });
  }

  /**
   * Get a specific provider by name (for testing or direct access)
   */
  getProvider(name: LLMProvider): ILLMProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  /**
   * Check health of all providers
   */
  async checkHealth(): Promise<void> {
    logger.info('Checking health of all providers');

    for (const provider of this.providers) {
      try {
        const isHealthy = await provider.isHealthy();
        const health = this.providerHealth.get(provider.name);
        if (health) {
          health.isHealthy = isHealthy;
          health.lastChecked = new Date();
        }
        logger.debug(`Provider ${provider.name} health: ${isHealthy}`);
      } catch (error) {
        logger.warn(`Health check failed for provider ${provider.name}`);
        const health = this.providerHealth.get(provider.name);
        if (health) {
          health.isHealthy = false;
          health.lastChecked = new Date();
        }
      }
    }
  }
}
