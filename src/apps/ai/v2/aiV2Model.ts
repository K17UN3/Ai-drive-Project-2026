import { pool } from '../../../../db';

// 公開用：会話スレッドの型定義
export interface AiConversationItem {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// 公開用：会話1往復の型定義
export interface AiConversationTurnItem {
  id: number;
  conversationId: number;
  userMessage: string;
  modelMessage: string;
  createdAt: string;
}

// DB行型定義
interface DbConversationRow {
  id: string | number;
  title: string;
  created_at: Date;
  updated_at: Date;
}

interface DbTurnRow {
  id: string | number;
  conversation_id: string | number;
  user_message: string;
  model_message: string;
  created_at: Date;
}

const formatConversation = (row: DbConversationRow): AiConversationItem => ({
  id: Number(row.id),
  title: row.title,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const formatTurn = (row: DbTurnRow): AiConversationTurnItem => ({
  id: Number(row.id),
  conversationId: Number(row.conversation_id),
  userMessage: row.user_message,
  modelMessage: row.model_message,
  createdAt: row.created_at.toISOString(),
});

export const aiV2Model = {
  /**
   * 保存済み会話一覧を取得（更新日時降順・ID降順、最大20件）
   */
  async findRecentConversations(limit: number = 20): Promise<AiConversationItem[]> {
    const query = `
      SELECT id, title, created_at, updated_at
      FROM ai_conversations
      ORDER BY updated_at DESC, id DESC
      LIMIT $1;
    `;
    const result = await pool.query<DbConversationRow>(query, [limit]);
    return result.rows.map(formatConversation);
  },

  /**
   * 新規会話スレッドを作成
   */
  async createConversation(title: string = '新しい会話'): Promise<AiConversationItem> {
    const cleanTitle = title.trim() || '新しい会話';
    const query = `
      INSERT INTO ai_conversations (title)
      VALUES ($1)
      RETURNING id, title, created_at, updated_at;
    `;
    const result = await pool.query<DbConversationRow>(query, [cleanTitle]);
    return formatConversation(result.rows[0]);
  },

  /**
   * 会話IDで会話1件を取得（存在確認およびタイトル取得用）
   */
  async findConversationById(conversationId: number): Promise<AiConversationItem | null> {
    const query = `
      SELECT id, title, created_at, updated_at
      FROM ai_conversations
      WHERE id = $1;
    `;
    const result = await pool.query<DbConversationRow>(query, [conversationId]);
    if (result.rows.length === 0) {
      return null;
    }
    return formatConversation(result.rows[0]);
  },

  /**
   * 画面表示用の往復履歴を取得（最新20往復を取得し、時系列昇順に並べ替えて返す）
   */
  async findTurnsForDisplay(conversationId: number, limit: number = 20): Promise<AiConversationTurnItem[]> {
    const query = `
      SELECT id, conversation_id, user_message, model_message, created_at
      FROM ai_conversation_turns
      WHERE conversation_id = $1
      ORDER BY id DESC
      LIMIT $2;
    `;
    const result = await pool.query<DbTurnRow>(query, [conversationId, limit]);
    // 古い順→新しい順（上から下へ会話の流れが追える順）に反転
    return result.rows.reverse().map(formatTurn);
  },

  /**
   * Gemini文脈送信用の直近履歴を取得（最新5往復を取得し、時系列昇順に並べ替えて返す）
   */
  async findRecentTurnsForContext(conversationId: number, limit: number = 5): Promise<AiConversationTurnItem[]> {
    const query = `
      SELECT id, conversation_id, user_message, model_message, created_at
      FROM ai_conversation_turns
      WHERE conversation_id = $1
      ORDER BY id DESC
      LIMIT $2;
    `;
    const result = await pool.query<DbTurnRow>(query, [conversationId, limit]);
    return result.rows.reverse().map(formatTurn);
  },

  /**
   * 1往復を保存し、親会話の updated_at（および初回時はタイトル）をトランザクション内で更新する
   */
  async saveTurnAndTouchConversation(
    conversationId: number,
    userMessage: string,
    modelMessage: string,
    isFirstTurn: boolean
  ): Promise<{ turn: AiConversationTurnItem; conversation: AiConversationItem }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 往復ログを 1レコードとして保存
      const insertTurnQuery = `
        INSERT INTO ai_conversation_turns (conversation_id, user_message, model_message)
        VALUES ($1, $2, $3)
        RETURNING id, conversation_id, user_message, model_message, created_at;
      `;
      const turnResult = await client.query<DbTurnRow>(insertTurnQuery, [
        conversationId,
        userMessage,
        modelMessage,
      ]);

      // 2. 会話の updated_at を更新（初回往復かつデフォルトタイトルの場合は質問先頭25文字をタイトルに設定）
      const autoTitle = Array.from(userMessage).slice(0, 25).join('');
      const updateConvQuery = isFirstTurn
        ? `
          UPDATE ai_conversations
          SET
            title = CASE WHEN title = '新しい会話' THEN $2 ELSE title END,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, title, created_at, updated_at;
        `
        : `
          UPDATE ai_conversations
          SET updated_at = NOW()
          WHERE id = $1
          RETURNING id, title, created_at, updated_at;
        `;

      const convParams = isFirstTurn ? [conversationId, autoTitle] : [conversationId];
      const convResult = await client.query<DbConversationRow>(updateConvQuery, convParams);

      if (convResult.rows.length === 0) {
        throw new Error('対象会話の更新に失敗しました');
      }

      await client.query('COMMIT');

      return {
        turn: formatTurn(turnResult.rows[0]),
        conversation: formatConversation(convResult.rows[0]),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};