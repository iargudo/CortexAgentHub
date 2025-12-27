import {
  RoutingRule,
  RoutingAction,
  RoutingCondition,
  MessageRouterConfig,
  IncomingMessage,
  LLMProvider,
  ChannelType,
  createLogger,
} from '@cortex/shared';

const logger = createLogger('MessageRouter');

/**
 * Message Router - Routes messages to appropriate LLM based on rules
 */
export class MessageRouter {
  private rules: RoutingRule[];
  private defaultProvider: LLMProvider;
  private defaultModel: string;

  constructor(config: MessageRouterConfig) {
    this.rules = config.rules.sort((a, b) => b.priority - a.priority); // Sort by priority DESC
    this.defaultProvider = config.defaultProvider;
    this.defaultModel = config.defaultModel;

    logger.info('MessageRouter initialized', {
      rulesCount: this.rules.length,
      defaultProvider: this.defaultProvider,
    });
  }

  /**
   * Route a message to determine which LLM to use
   */
  route(message: IncomingMessage, userId?: string): RoutingAction {
    logger.debug('Routing message', {
      channelType: message.channelType,
      userId: userId || message.channelUserId,
    });

    // Try to match rules in priority order
    for (const rule of this.rules) {
      if (!rule.active) {
        continue;
      }

      if (this.matchesCondition(rule.condition, message, userId)) {
        logger.info('Matched routing rule', {
          ruleName: rule.name,
          priority: rule.priority,
          provider: rule.action.llmProvider,
        });

        return rule.action;
      }
    }

    // Return default action if no rule matches
    logger.debug('No rule matched, using default', {
      provider: this.defaultProvider,
      model: this.defaultModel,
    });

    return {
      llmProvider: this.defaultProvider,
      llmModel: this.defaultModel,
    };
  }

  /**
   * Check if a message matches a routing condition
   */
  private matchesCondition(
    condition: RoutingCondition,
    message: IncomingMessage,
    userId?: string
  ): boolean {
    // Check channel type
    if (condition.channelType) {
      const channels = Array.isArray(condition.channelType)
        ? condition.channelType
        : [condition.channelType];

      if (!channels.includes(message.channelType)) {
        return false;
      }
    }

    // Check user ID
    if (condition.userId) {
      const userIds = Array.isArray(condition.userId) ? condition.userId : [condition.userId];
      const targetUserId = userId || message.channelUserId;

      if (!userIds.includes(targetUserId)) {
        return false;
      }
    }

    // Check user segment (would typically come from a user service/database)
    if (condition.userSegment) {
      // This would need to be implemented with actual user data
      // For now, we'll check if it's in metadata
      const userSegment = message.metadata?.userSegment;
      if (userSegment !== condition.userSegment) {
        return false;
      }
    }

    // Check message pattern (regex)
    if (condition.messagePattern) {
      try {
        const regex = new RegExp(condition.messagePattern, 'i');
        if (!regex.test(message.content)) {
          return false;
        }
      } catch (error) {
        logger.warn('Invalid regex pattern in condition', {
          pattern: condition.messagePattern,
        });
        return false;
      }
    }

    // Check time range
    if (condition.timeRange) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;

      if (currentTime < condition.timeRange.start || currentTime > condition.timeRange.end) {
        return false;
      }
    }

    // Check custom conditions
    if (condition.custom) {
      // Custom conditions would be evaluated here
      // This could be extended based on specific needs
    }

    return true;
  }

  /**
   * Add a new routing rule
   */
  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
    logger.info('Routing rule added', { ruleName: rule.name, priority: rule.priority });
  }

  /**
   * Remove a routing rule
   */
  removeRule(ruleId: string): boolean {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== ruleId);
    const removed = this.rules.length < initialLength;

    if (removed) {
      logger.info('Routing rule removed', { ruleId });
    }

    return removed;
  }

  /**
   * Update a routing rule
   */
  updateRule(ruleId: string, updates: Partial<RoutingRule>): boolean {
    const ruleIndex = this.rules.findIndex((r) => r.id === ruleId);

    if (ruleIndex === -1) {
      return false;
    }

    this.rules[ruleIndex] = { ...this.rules[ruleIndex], ...updates };
    this.rules.sort((a, b) => b.priority - a.priority);

    logger.info('Routing rule updated', { ruleId });
    return true;
  }

  /**
   * Get all routing rules
   */
  getRules(): RoutingRule[] {
    return [...this.rules];
  }

  /**
   * Get active routing rules
   */
  getActiveRules(): RoutingRule[] {
    return this.rules.filter((r) => r.active);
  }

  /**
   * Get a specific rule by ID
   */
  getRule(ruleId: string): RoutingRule | undefined {
    return this.rules.find((r) => r.id === ruleId);
  }

  /**
   * Test which rule would match for a given message
   */
  testRoute(message: IncomingMessage, userId?: string): {
    matched: boolean;
    rule?: RoutingRule;
    action: RoutingAction;
  } {
    for (const rule of this.rules) {
      if (!rule.active) {
        continue;
      }

      if (this.matchesCondition(rule.condition, message, userId)) {
        return {
          matched: true,
          rule,
          action: rule.action,
        };
      }
    }

    return {
      matched: false,
      action: {
        llmProvider: this.defaultProvider,
        llmModel: this.defaultModel,
      },
    };
  }

  /**
   * Set default provider and model
   */
  setDefault(provider: LLMProvider, model: string): void {
    this.defaultProvider = provider;
    this.defaultModel = model;
    logger.info('Default provider updated', { provider, model });
  }
}
