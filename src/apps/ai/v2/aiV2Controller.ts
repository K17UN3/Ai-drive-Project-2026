import { Request, Response } from 'express';
import { aiV2Model } from './aiV2Model';
import { aiV2Service, GeminiContentTurn } from './aiV2Service';
import { AiServiceError } from '../aiService';

/**
 * 正の整数IDの検証ヘルパー
 */
function parsePositiveIntId(rawId: unknown): number | null {
  if (typeof rawId !== 'string' || !/^[1-9]\d*$/.test(rawId)) {
    return null;
  }
  const num = Number(rawId);
  if (!Number.isSafeInteger(num) || num <= 0) {
    return null;
  }
  return num;
}

export const aiV2Controller = {
  /**
   * GET /api/ai/v2/conversations - 保存済み会話一覧取得
   */
  async getConversations(req: Request, res: Response) {
    // 公開停止ガード (APIキー未設定時は503)
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: '現在AI質問機能は停止中です。設定をご確認ください。',
        details: [],
      });
    }

    try {
      const conversations = await aiV2Model.findRecentConversations(20);
      return res.status(200).json({
        status: 'success',
        data: {
          conversations,
        },
      });
    } catch (err) {
      console.error('[V2 getConversations Error]:', err);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: '会話一覧の取得中にデータベースエラーが発生しました',
        details: [],
      });
    }
  },

  /**
   * POST /api/ai/v2/conversations - 新規会話スレッド作成
   */
  async createConversation(req: Request, res: Response) {
    // 公開停止ガード
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: '現在AI質問機能は停止中です。設定をご確認ください。',
        details: [],
      });
    }

    try {
      const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      // タイトル指定がある場合はコードポイント上限100文字に制限
      const safeTitle = rawTitle.length > 0
        ? Array.from(rawTitle).slice(0, 100).join('')
        : '新しい会話';

      const conversation = await aiV2Model.createConversation(safeTitle);
      return res.status(201).json({
        status: 'success',
        data: {
          conversation,
        },
      });
    } catch (err) {
      console.error('[V2 createConversation Error]:', err);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: '新規会話の作成中にデータベースエラーが発生しました',
        details: [],
      });
    }
  },

  /**
   * GET /api/ai/v2/conversations/:id/turns - 指定会話の往復履歴取得（最新20往復）
   */
  async getConversationTurns(req: Request, res: Response) {
    // 公開停止ガード
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: '現在AI質問機能は停止中です。設定をご確認ください。',
        details: [],
      });
    }

    try {
      const conversationId = parsePositiveIntId(req.params.id);
      if (conversationId === null) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_CONVERSATION_ID',
          message: '会話IDは正の整数で指定してください',
          details: [],
        });
      }

      // 会話の存在確認
      const conversation = await aiV2Model.findConversationById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          status: 'error',
          code: 'CONVERSATION_NOT_FOUND',
          message: '指定された会話が見つかりません',
          details: [],
        });
      }

      // 最新20往復を時系列順（古い→新しい）で取得
      const turns = await aiV2Model.findTurnsForDisplay(conversationId, 20);

      return res.status(200).json({
        status: 'success',
        data: {
          conversation: {
            id: conversation.id,
            title: conversation.title,
          },
          turns,
        },
      });
    } catch (err) {
      console.error('[V2 getConversationTurns Error]:', err);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: '会話履歴の取得中にデータベースエラーが発生しました',
        details: [],
      });
    }
  },

  /**
   * POST /api/ai/v2/conversations/:id/turns - 文脈付き質問送信・1往復保存
   * 順序: 入力と会話の存在確認 → 直近5往復履歴取得 → user/model/user 組立 → Gemini呼出 → 1往復保存 → 201返却
   */
  async postTurn(req: Request, res: Response) {
    // 0. 公開停止ガード (503)
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: '現在AI質問機能は停止中です。設定をご確認ください。',
        details: [],
      });
    }

    try {
      // 1-a. 会話IDの形式検証 (400)
      const conversationId = parsePositiveIntId(req.params.id);
      if (conversationId === null) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_CONVERSATION_ID',
          message: '会話IDは正の整数で指定してください',
          details: [],
        });
      }

      // 1-b. 質問テキストの入力検証 (question または prompt を受け付け、1〜2000コードポイントに制限)
      const rawInput =
        typeof req.body?.question === 'string'
          ? req.body.question
          : typeof req.body?.prompt === 'string'
          ? req.body.prompt
          : null;

      if (rawInput === null) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_INPUT',
          message: '質問テキストは文字列で入力してください',
          details: [],
        });
      }

      const trimmedQuestion = rawInput.trim();
      const codePointLength = Array.from(trimmedQuestion).length;
      if (codePointLength === 0 || codePointLength > 2000) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: '質問は空白を除く1文字以上2000文字以内で入力してください',
          details: [],
        });
      }

      // 1-c. 会話の存在確認 (404)
      const conversation = await aiV2Model.findConversationById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          status: 'error',
          code: 'CONVERSATION_NOT_FOUND',
          message: '指定された会話が見つかりません',
          details: [],
        });
      }

      // 2. 同じ会話の履歴取得（直近最大5往復・古い順）
      const recentTurns = await aiV2Model.findRecentTurnsForContext(conversationId, 5);
      const isFirstTurn = recentTurns.length === 0;

      // 3. Gemini用 contents 配列の組み立て（過去の質問=user, 過去の回答=model, 今回の質問=最後のuser）
      const contents: GeminiContentTurn[] = [];
      for (const turn of recentTurns) {
        contents.push({
          role: 'user',
          parts: [{ text: turn.userMessage }],
        });
        contents.push({
          role: 'model',
          parts: [{ text: turn.modelMessage }],
        });
      }
      contents.push({
        role: 'user',
        parts: [{ text: trimmedQuestion }],
      });

      // 4. Gemini API 呼び出し（失敗時は例外送出され、DB保存は行われない）
      const answerText = await aiV2Service.generateTurnAnswer(contents, conversationId);

      // 5. 1往復の保存と親会話の更新
      const saved = await aiV2Model.saveTurnAndTouchConversation(
        conversationId,
        trimmedQuestion,
        answerText,
        isFirstTurn
      );

      // 6. 201 Created 返却
      return res.status(201).json({
        status: 'success',
        data: {
          conversation: {
            id: saved.conversation.id,
            title: saved.conversation.title,
            updatedAt: saved.conversation.updatedAt,
          },
          turn: {
            id: saved.turn.id,
            userMessage: saved.turn.userMessage,
            modelMessage: saved.turn.modelMessage,
            createdAt: saved.turn.createdAt,
          },
        },
      });
    } catch (err: any) {
      if (err instanceof AiServiceError) {
        return res.status(err.statusCode).json({
          status: 'error',
          code: err.code,
          message: err.message,
          details: [],
        });
      }

      console.error('[V2 postTurn Error]:', err);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'AI回答の生成・保存中に予期せぬエラーが発生しました',
        details: [],
      });
    }
  },
};