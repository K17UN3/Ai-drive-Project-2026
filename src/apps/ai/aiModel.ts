import { pool } from '../../../db';

// 公開用の型定義
export interface AiQaLogItem {
  id: number;
  prompt: string;
  response: string;
  createdAt: string;
}

// DB行の型定義
interface DbAiQaLogRow {
  id: string | number;
  prompt: string;
  response_text: string | null;
  created_at: Date;
}

const formatAiQaLog = (row: DbAiQaLogRow): AiQaLogItem => ({
  id: Number(row.id),
  prompt: row.prompt,
  response: row.response_text || '',
  createdAt: row.created_at.toISOString(),
});

export const aiModel = {
  // 最新20件のログを取得 (固定SELECT)
  async findRecentLogs(limit: number = 20): Promise<AiQaLogItem[]> {
    const query = `
      SELECT id, prompt, response_text, created_at
      FROM ai_qa_logs
      ORDER BY id DESC
      LIMIT $1;
    `;
    const result = await pool.query<DbAiQaLogRow>(query, [limit]);
    return result.rows.map(formatAiQaLog);
  },

  // ログの新規作成 (パラメータ化クエリ $1, $2)
  async saveLog(prompt: string, responseText: string | null): Promise<AiQaLogItem> {
    const query = `
      INSERT INTO ai_qa_logs (prompt, response_text)
      VALUES ($1, $2)
      RETURNING id, prompt, response_text, created_at;
    `;
    const result = await pool.query<DbAiQaLogRow>(query, [prompt, responseText]);
    return formatAiQaLog(result.rows[0]);
  },
};