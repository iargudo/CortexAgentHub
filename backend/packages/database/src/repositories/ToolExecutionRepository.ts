import { BaseRepository } from './BaseRepository';
import { ToolExecution } from '@cortex/shared';

/**
 * Tool Execution Repository
 */
export class ToolExecutionRepository extends BaseRepository<ToolExecution> {
  protected tableName = 'tool_executions';

  /**
   * Find tool executions by conversation ID
   */
  async findByConversationId(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ToolExecution[]> {
    const result = await this.query<ToolExecution>(
      `SELECT * FROM ${this.tableName}
       WHERE conversation_id = $1
       ORDER BY executed_at DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );
    return result.rows;
  }

  /**
   * Find tool executions by tool name
   */
  async findByToolName(
    toolName: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<ToolExecution[]> {
    const result = await this.query<ToolExecution>(
      `SELECT * FROM ${this.tableName}
       WHERE tool_name = $1
       ORDER BY executed_at DESC
       LIMIT $2 OFFSET $3`,
      [toolName, limit, offset]
    );
    return result.rows;
  }

  /**
   * Find failed tool executions
   */
  async findFailed(limit: number = 50, offset: number = 0): Promise<ToolExecution[]> {
    const result = await this.query<ToolExecution>(
      `SELECT * FROM ${this.tableName}
       WHERE success = false
       ORDER BY executed_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  /**
   * Get tool execution statistics
   */
  async getStats(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    avgExecutionTime: number;
    byTool: Record<
      string,
      {
        count: number;
        successRate: number;
        avgTime: number;
      }
    >;
  }> {
    let whereClause = '';
    const params: any[] = [];

    if (startDate || endDate) {
      whereClause = ' WHERE';
      if (startDate) {
        whereClause += ` executed_at >= $${params.length + 1}`;
        params.push(startDate);
      }
      if (endDate) {
        if (startDate) whereClause += ' AND';
        whereClause += ` executed_at <= $${params.length + 1}`;
        params.push(endDate);
      }
    }

    const [overallResult, toolResult] = await Promise.all([
      this.query<{
        total: string;
        successful: string;
        avg_time: string;
      }>(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
          AVG(execution_time) as avg_time
         FROM ${this.tableName}${whereClause}`,
        params
      ),
      this.query<{
        tool_name: string;
        count: string;
        successful: string;
        avg_time: string;
      }>(
        `SELECT
          tool_name,
          COUNT(*) as count,
          SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
          AVG(execution_time) as avg_time
         FROM ${this.tableName}${whereClause}
         GROUP BY tool_name`,
        params
      ),
    ]);

    const overall = overallResult.rows[0];
    const total = parseInt(overall.total);
    const successful = parseInt(overall.successful);
    const failed = total - successful;

    const byTool: Record<
      string,
      { count: number; successRate: number; avgTime: number }
    > = {};

    toolResult.rows.forEach((row) => {
      const count = parseInt(row.count);
      const successCount = parseInt(row.successful);
      byTool[row.tool_name] = {
        count,
        successRate: count > 0 ? successCount / count : 0,
        avgTime: parseFloat(row.avg_time || '0'),
      };
    });

    return {
      total,
      successful,
      failed,
      avgExecutionTime: parseFloat(overall.avg_time || '0'),
      byTool,
    };
  }

  /**
   * Get top tools by usage
   */
  async getTopTools(
    limit: number = 10,
    startDate?: Date,
    endDate?: Date
  ): Promise<
    Array<{
      toolName: string;
      executionCount: number;
      successRate: number;
      avgExecutionTime: number;
    }>
  > {
    let whereClause = '';
    const params: any[] = [];

    if (startDate || endDate) {
      whereClause = ' WHERE';
      if (startDate) {
        whereClause += ` executed_at >= $${params.length + 1}`;
        params.push(startDate);
      }
      if (endDate) {
        if (startDate) whereClause += ' AND';
        whereClause += ` executed_at <= $${params.length + 1}`;
        params.push(endDate);
      }
    }

    params.push(limit);

    const result = await this.query<{
      tool_name: string;
      execution_count: string;
      success_rate: string;
      avg_execution_time: string;
    }>(
      `SELECT
        tool_name,
        COUNT(*) as execution_count,
        CAST(SUM(CASE WHEN success THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as success_rate,
        AVG(execution_time) as avg_execution_time
       FROM ${this.tableName}${whereClause}
       GROUP BY tool_name
       ORDER BY execution_count DESC
       LIMIT $${params.length}`,
      params
    );

    return result.rows.map((row) => ({
      toolName: row.tool_name,
      executionCount: parseInt(row.execution_count),
      successRate: parseFloat(row.success_rate),
      avgExecutionTime: parseFloat(row.avg_execution_time),
    }));
  }
}
