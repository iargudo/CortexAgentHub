import { BaseRepository } from './BaseRepository';
import { Message, MessageRole } from '@cortex/shared';

/**
 * Message Repository
 */
export class MessageRepository extends BaseRepository<Message> {
  protected tableName = 'messages';

  /**
   * Find messages by conversation ID
   */
  async findByConversationId(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Message[]> {
    const result = await this.query<Message>(
      `SELECT * FROM ${this.tableName}
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );
    return result.rows;
  }

  /**
   * Find messages by user ID
   */
  async findByUserId(
    userId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<Message[]> {
    const result = await this.query<Message>(
      `SELECT m.* FROM ${this.tableName} m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE c.user_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  /**
   * Find messages by role
   */
  async findByRole(
    role: MessageRole,
    limit: number = 100,
    offset: number = 0
  ): Promise<Message[]> {
    const result = await this.query<Message>(
      `SELECT * FROM ${this.tableName}
       WHERE role = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [role, limit, offset]
    );
    return result.rows;
  }

  /**
   * Get recent messages across all conversations
   */
  async getRecent(limit: number = 50): Promise<Message[]> {
    const result = await this.query<Message>(
      `SELECT * FROM ${this.tableName}
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  /**
   * Search messages by content
   */
  async search(
    query: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Message[]> {
    const result = await this.query<Message>(
      `SELECT * FROM ${this.tableName}
       WHERE content ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [`%${query}%`, limit, offset]
    );
    return result.rows;
  }

  /**
   * Get token usage statistics
   */
  async getTokenStats(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalTokens: number;
    totalCost: number;
    byProvider: Record<string, { tokens: number; cost: number }>;
  }> {
    let query = `
      SELECT
        llm_provider,
        SUM(prompt_tokens + completion_tokens) as total_tokens,
        SUM(total_cost) as total_cost
      FROM ${this.tableName}
      WHERE role = $1
    `;
    const params: any[] = [MessageRole.ASSISTANT];

    if (startDate) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` GROUP BY llm_provider`;

    const result = await this.query<{
      llm_provider: string;
      total_tokens: string;
      total_cost: string;
    }>(query, params);

    const byProvider: Record<string, { tokens: number; cost: number }> = {};
    let totalTokens = 0;
    let totalCost = 0;

    result.rows.forEach((row) => {
      const tokens = parseInt(row.total_tokens || '0');
      const cost = parseFloat(row.total_cost || '0');
      byProvider[row.llm_provider] = { tokens, cost };
      totalTokens += tokens;
      totalCost += cost;
    });

    return { totalTokens, totalCost, byProvider };
  }

  /**
   * Get message statistics
   */
  async getStats(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    total: number;
    byRole: Record<string, number>;
    avgResponseTime: number;
  }> {
    let query = `SELECT COUNT(*) as total, role FROM ${this.tableName}`;
    const params: any[] = [];

    if (startDate || endDate) {
      query += ' WHERE';
      if (startDate) {
        query += ` created_at >= $${params.length + 1}`;
        params.push(startDate);
      }
      if (endDate) {
        if (startDate) query += ' AND';
        query += ` created_at <= $${params.length + 1}`;
        params.push(endDate);
      }
    }

    query += ' GROUP BY role';

    const [countResult, avgTimeResult] = await Promise.all([
      this.query<{ total: string; role: string }>(query, params),
      this.query<{ avg: string }>(
        `SELECT AVG(response_time) as avg FROM ${this.tableName}
         WHERE role = $1 AND response_time IS NOT NULL`,
        [MessageRole.ASSISTANT]
      ),
    ]);

    const byRole: Record<string, number> = {};
    let total = 0;

    countResult.rows.forEach((row) => {
      const count = parseInt(row.total);
      byRole[row.role] = count;
      total += count;
    });

    return {
      total,
      byRole,
      avgResponseTime: parseFloat(avgTimeResult.rows[0]?.avg || '0'),
    };
  }
}
