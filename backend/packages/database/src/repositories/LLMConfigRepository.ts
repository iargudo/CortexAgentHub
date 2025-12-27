import { BaseRepository } from './BaseRepository';
import { LLMProvider } from '@cortex/shared';

export interface LLMConfig {
  id: string;
  provider: LLMProvider;
  model: string;
  enabled: boolean;
  priority: number;
  config: any;
  created_at: Date;
  updated_at: Date;
}

/**
 * LLM Config Repository
 */
export class LLMConfigRepository extends BaseRepository<LLMConfig> {
  protected tableName = 'llm_configs';

  /**
   * Find LLM configs by provider
   */
  async findByProvider(provider: LLMProvider): Promise<LLMConfig[]> {
    const result = await this.query<LLMConfig>(
      `SELECT * FROM ${this.tableName} WHERE provider = $1 ORDER BY priority ASC`,
      [provider]
    );
    return result.rows;
  }

  /**
   * Find enabled LLM configs
   */
  async findEnabled(): Promise<LLMConfig[]> {
    const result = await this.query<LLMConfig>(
      `SELECT * FROM ${this.tableName} WHERE enabled = true ORDER BY priority ASC`
    );
    return result.rows;
  }

  /**
   * Toggle LLM enabled status
   */
  async toggleEnabled(id: string, enabled: boolean): Promise<LLMConfig | null> {
    const result = await this.query<LLMConfig>(
      `UPDATE ${this.tableName}
       SET enabled = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [enabled, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Update LLM priority
   */
  async updatePriority(id: string, priority: number): Promise<LLMConfig | null> {
    const result = await this.query<LLMConfig>(
      `UPDATE ${this.tableName}
       SET priority = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [priority, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Update LLM configuration
   */
  async updateConfig(id: string, config: any): Promise<LLMConfig | null> {
    const result = await this.query<LLMConfig>(
      `UPDATE ${this.tableName}
       SET config = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(config), id]
    );
    return result.rows[0] || null;
  }
}
