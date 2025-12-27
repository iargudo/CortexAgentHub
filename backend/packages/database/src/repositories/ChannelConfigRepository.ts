import { BaseRepository } from './BaseRepository';
import { ChannelType } from '@cortex/shared';

export interface ChannelConfig {
  id: string;
  channel_type: ChannelType;
  name: string;
  enabled: boolean;
  config: any;
  created_at: Date;
  updated_at: Date;
}

/**
 * Channel Config Repository
 */
export class ChannelConfigRepository extends BaseRepository<ChannelConfig> {
  protected tableName = 'channel_configs';

  /**
   * Find channel config by type
   */
  async findByType(channelType: ChannelType): Promise<ChannelConfig | null> {
    const result = await this.query<ChannelConfig>(
      `SELECT * FROM ${this.tableName} WHERE channel_type = $1 LIMIT 1`,
      [channelType]
    );
    return result.rows[0] || null;
  }

  /**
   * Find enabled channels
   */
  async findEnabled(): Promise<ChannelConfig[]> {
    const result = await this.query<ChannelConfig>(
      `SELECT * FROM ${this.tableName} WHERE enabled = true ORDER BY name`
    );
    return result.rows;
  }

  /**
   * Toggle channel enabled status
   */
  async toggleEnabled(id: string, enabled: boolean): Promise<ChannelConfig | null> {
    const result = await this.query<ChannelConfig>(
      `UPDATE ${this.tableName}
       SET enabled = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [enabled, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Update channel configuration
   */
  async updateConfig(id: string, config: any): Promise<ChannelConfig | null> {
    const result = await this.query<ChannelConfig>(
      `UPDATE ${this.tableName}
       SET config = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(config), id]
    );
    return result.rows[0] || null;
  }
}
