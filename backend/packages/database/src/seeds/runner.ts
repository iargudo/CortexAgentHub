import { getDatabase } from '../connection';
import { RepositoryFactory } from '../repositories';
import { ChannelType, LLMProvider, createLogger } from '@cortex/shared';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const logger = createLogger('SeedRunner');

/**
 * Seed Runner
 * Seeds initial data into the database
 */
class SeedRunner {
  private db = getDatabase();

  /**
   * Seed channel configurations
   */
  private async seedChannels(): Promise<void> {
    logger.info('Seeding channel configurations...');

    const channelRepo = RepositoryFactory.getChannelConfigRepository();

    const channels = [
      {
        channel_type: ChannelType.WEBCHAT,
        name: 'WebChat Default',
        active: true,
        config: {
          port: 8081,
          allowedOrigins: ['*'],
        },
      },
      {
        channel_type: ChannelType.WHATSAPP,
        name: 'WhatsApp Business',
        active: false,
        config: {
          provider: 'ultramsg',
          instanceId: '',
          token: '',
        },
      },
      {
        channel_type: ChannelType.TELEGRAM,
        name: 'Telegram Bot',
        active: false,
        config: {
          botToken: '',
          webhookUrl: '',
        },
      },
      {
        channel_type: ChannelType.EMAIL,
        name: 'Email Support',
        active: false,
        config: {
          smtp: {
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
          },
        },
      },
    ];

    for (const channel of channels) {
      try {
        const existing = await channelRepo.findAll({ name: channel.name }, 1);
        if (existing.length === 0) {
          await channelRepo.create(channel);
          logger.info(`Created channel: ${channel.name}`);
        }
      } catch (error: any) {
        logger.error(`Failed to seed channel ${channel.name}`, {
          error: error.message,
        });
      }
    }
  }

  /**
   * Seed LLM configurations
   */
  private async seedLLMs(): Promise<void> {
    logger.info('Seeding LLM configurations...');

    const llmRepo = RepositoryFactory.getLLMConfigRepository();

    const llms = [
      {
        provider: LLMProvider.OPENAI,
        model: 'gpt-4',
        active: false,
        priority: 1,
        config: {
          apiKey: process.env.OPENAI_API_KEY || '',
          temperature: 0.7,
          maxTokens: 2000,
        },
      },
      {
        provider: LLMProvider.OPENAI,
        model: 'gpt-3.5-turbo',
        active: false,
        priority: 2,
        config: {
          apiKey: process.env.OPENAI_API_KEY || '',
          temperature: 0.7,
          maxTokens: 2000,
        },
      },
      {
        provider: LLMProvider.ANTHROPIC,
        model: 'claude-3-opus-20240229',
        active: false,
        priority: 3,
        config: {
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          temperature: 0.7,
          maxTokens: 2000,
        },
      },
      {
        provider: LLMProvider.OLLAMA,
        model: 'llama2',
        active: true,
        priority: 10,
        config: {
          baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
          temperature: 0.7,
        },
      },
    ];

    for (const llm of llms) {
      try {
        const existing = await llmRepo.findAll({ provider: llm.provider, model: llm.model }, 1);
        if (existing.length === 0) {
          await llmRepo.create(llm);
          logger.info(`Created LLM config: ${llm.provider}/${llm.model}`);
        }
      } catch (error: any) {
        logger.error(`Failed to seed LLM ${llm.provider}/${llm.model}`, {
          error: error.message,
        });
      }
    }
  }

  /**
   * Run all seeds
   */
  async run(): Promise<void> {
    try {
      logger.info('Starting database seeding...');

      await this.seedChannels();
      await this.seedLLMs();

      logger.info('Database seeding completed successfully');
    } catch (error: any) {
      logger.error('Seeding failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Clear all seeded data
   */
  async clear(): Promise<void> {
    logger.warn('Clearing seeded data...');

    try {
      await this.db.query('DELETE FROM llm_configs');
      await this.db.query('DELETE FROM channel_configs');

      logger.info('Seeded data cleared');
    } catch (error: any) {
      logger.error('Failed to clear seeded data', { error: error.message });
      throw error;
    }
  }
}

/**
 * CLI Entry point
 */
async function main() {
  const runner = new SeedRunner();
  const command = process.argv[2] || 'run';

  try {
    switch (command) {
      case 'run':
        await runner.run();
        break;
      case 'clear':
        await runner.clear();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Available commands: run, clear');
        process.exit(1);
    }

    await getDatabase().close();
    process.exit(0);
  } catch (error) {
    logger.error('Seed runner failed', { error });
    await getDatabase().close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { SeedRunner };
