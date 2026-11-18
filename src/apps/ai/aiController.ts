import { Request, Response } from 'express';
import { aiModel } from './aiModel';
import { aiService, AiServiceError } from './aiService';

export const aiController = {
  // GET /ai - 画面レンダリングハンドラ
  renderPage(req: Request, res: Response) {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).render('ai/index', {
        disabled: true,
        message: '現在AI質問機能は利用できません。（APIキー未設定）',
      });
    }

    res.render('ai/index', {
      disabled: false,
      message: null,
    });
  },

  // POST /api/ai/ask - 質問送信エンドポイント
  async askQuestion(req: Request, res: Response) {
    // 1. 共通デモ停止ガード
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: '現在AI質問機能は利用できません。設定をご確認ください',
        details: [],
      });
    }

    try {
      const { question } = req.body || {};

      // 2. 本番用入力検証 (型チェック & 空白トリム & 文字数1~1000制限)
      if (typeof question !== 'string') {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_INPUT',
          message: '質問テキストは文字列で入力してください',
          details: [],
        });
      }

      const trimmedQuestion = question.trim();
      if (trimmedQuestion.length === 0 || trimmedQuestion.length > 1000) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: '質問は1文字以上1000文字以内で入力してください',
          details: [],
        });
      }

      // 3. Service層の呼び出し (実Gemini API呼出し)
      const answerText = await aiService.generateAnswer(trimmedQuestion);

      // 4. DBへ対話ログを保存 (保存完了を確認してから 201 を返す)
      const savedLog = await aiModel.saveLog(trimmedQuestion, answerText);

      // 5. 保存完了確認後 201 Created レスポンス返却
      return res.status(201).json({
        status: 'success',
        data: {
          id: savedLog.id,
          answer: answerText,
          askedAt: savedLog.createdAt,
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

      console.error('Error in askQuestion:', err);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'AI回答の生成中に予期せぬエラーが発生しました',
        details: [],
      });
    }
  },

  // GET /api/ai/history - 履歴取得エンドポイント
  async getHistory(req: Request, res: Response) {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: '現在AI質問機能は利用できません。設定をご確認ください',
        details: [],
      });
    }

    try {
      const items = await aiModel.findRecentLogs(20);
      return res.status(200).json({
        status: 'success',
        data: {
          success: true,
          items,
        },
      });
    } catch (err) {
      console.error('Error in getHistory:', err);
      return res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'データベースエラーが発生しました',
        details: [],
      });
    }
  },
};