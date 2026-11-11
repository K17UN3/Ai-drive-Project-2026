import { Request, Response } from 'express';
import { aiModel } from './aiModel';

export const aiController = {
  // GET /ai - 画面レンダリングハンドラ
  renderPage(req: Request, res: Response) {
    // デモ停止ガード（APIキー未設定時）
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

  // POST /api/ai/ask - 質問送信エンドポイント（骨組み）
  async askQuestion(req: Request, res: Response) {
    // デモ停止ガード（APIキー未設定時）
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: '現在AI質問機能は利用できません。設定をご確認ください',
        details: [],
      });
    }

    // TASK-01 では正常疎通用の仮レスポンスを返却
    res.status(200).json({
      status: 'success',
      data: {
        message: 'AI質問機能のエンドポイントが準備されました (TASK-01)',
      },
    });
  },

  // GET /api/ai/history - 履歴取得エンドポイント
  async getHistory(req: Request, res: Response) {
    // デモ停止ガード（APIキー未設定時）
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
      res.status(200).json({
        status: 'success',
        data: {
          success: true,
          items,
        },
      });
    } catch (err) {
      console.error('Error in getHistory:', err);
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'データベースエラーが発生しました',
        details: [],
      });
    }
  },
};