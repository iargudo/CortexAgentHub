import { BaseRepository } from './BaseRepository';
import {
  Conversation,
  ConversationStatus,
  ChannelType,
} from '@cortex/shared';

/**
 * Conversation Repository
 */
export class ConversationRepository extends BaseRepository<Conversation> {
  protected tableName = 'conversations';

  /**
   * Find conversations by user ID
   */
  async findByUserId(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Conversation[]> {
    const result = await this.query<Conversation>(
      `SELECT * FROM ${this.tableName}
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  /**
   * Find conversations by channel type
   */
  async findByChannelType(
    channelType: ChannelType,
    limit: number = 50,
    offset: number = 0
  ): Promise<Conversation[]> {
    const result = await this.query<Conversation>(
      `SELECT * FROM ${this.tableName}
       WHERE channel_type = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [channelType, limit, offset]
    );
    return result.rows;
  }

  /**
   * Find active conversations (last activity within hours)
   */
  async findActive(hours: number = 24): Promise<Conversation[]> {
    const result = await this.query<Conversation>(
      `SELECT * FROM ${this.tableName}
       WHERE status = $1
       AND updated_at > NOW() - INTERVAL '${hours} hours'
       ORDER BY updated_at DESC`,
      [ConversationStatus.ACTIVE]
    );
    return result.rows;
  }

  /**
   * Update conversation status
   */
  async updateStatus(
    id: string,
    status: ConversationStatus
  ): Promise<Conversation | null> {
    const result = await this.query<Conversation>(
      `UPDATE ${this.tableName}
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get conversation statistics
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    byChannel: Record<string, number>;
    byStatus: Record<string, number>;
  }> {
    const [totalResult, activeResult, channelResult, statusResult] =
      await Promise.all([
        this.query<{ count: string }>(`SELECT COUNT(*) as count FROM ${this.tableName}`),
        this.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM ${this.tableName} WHERE status = $1`,
          [ConversationStatus.ACTIVE]
        ),
        this.query<{ channel_type: string; count: string }>(
          `SELECT channel_type, COUNT(*) as count FROM ${this.tableName} GROUP BY channel_type`
        ),
        this.query<{ status: string; count: string }>(
          `SELECT status, COUNT(*) as count FROM ${this.tableName} GROUP BY status`
        ),
      ]);

    return {
      total: parseInt(totalResult.rows[0].count),
      active: parseInt(activeResult.rows[0].count),
      byChannel: channelResult.rows.reduce(
        (acc, row) => {
          acc[row.channel_type] = parseInt(row.count);
          return acc;
        },
        {} as Record<string, number>
      ),
      byStatus: statusResult.rows.reduce(
        (acc, row) => {
          acc[row.status] = parseInt(row.count);
          return acc;
        },
        {} as Record<string, number>
      ),
    };
  }
}
