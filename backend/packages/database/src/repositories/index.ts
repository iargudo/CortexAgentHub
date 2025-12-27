export * from './BaseRepository';
export * from './ConversationRepository';
export * from './MessageRepository';
export * from './ToolExecutionRepository';
export * from './ChannelConfigRepository';
export * from './LLMConfigRepository';

import { ConversationRepository } from './ConversationRepository';
import { MessageRepository } from './MessageRepository';
import { ToolExecutionRepository } from './ToolExecutionRepository';
import { ChannelConfigRepository } from './ChannelConfigRepository';
import { LLMConfigRepository } from './LLMConfigRepository';

/**
 * Repository Factory
 * Provides singleton instances of all repositories
 */
export class RepositoryFactory {
  private static conversationRepo: ConversationRepository;
  private static messageRepo: MessageRepository;
  private static toolExecutionRepo: ToolExecutionRepository;
  private static channelConfigRepo: ChannelConfigRepository;
  private static llmConfigRepo: LLMConfigRepository;

  static getConversationRepository(): ConversationRepository {
    if (!this.conversationRepo) {
      this.conversationRepo = new ConversationRepository();
    }
    return this.conversationRepo;
  }

  static getMessageRepository(): MessageRepository {
    if (!this.messageRepo) {
      this.messageRepo = new MessageRepository();
    }
    return this.messageRepo;
  }

  static getToolExecutionRepository(): ToolExecutionRepository {
    if (!this.toolExecutionRepo) {
      this.toolExecutionRepo = new ToolExecutionRepository();
    }
    return this.toolExecutionRepo;
  }

  static getChannelConfigRepository(): ChannelConfigRepository {
    if (!this.channelConfigRepo) {
      this.channelConfigRepo = new ChannelConfigRepository();
    }
    return this.channelConfigRepo;
  }

  static getLLMConfigRepository(): LLMConfigRepository {
    if (!this.llmConfigRepo) {
      this.llmConfigRepo = new LLMConfigRepository();
    }
    return this.llmConfigRepo;
  }
}
