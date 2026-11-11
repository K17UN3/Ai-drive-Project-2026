import { Request, Response } from 'express';

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

  // POST /api/v1/ai/ask - 質問送信エンドポイント（骨組み）
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
};