import { Request, Response } from 'express';
import { chatService, ChatServiceError } from './chatService';

/**
 * 0以上の整数IDパース用ヘルパー（afterId用）
 */
function parseNonNegativeInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 0;
  }
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) {
    return null;
  }
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < 0) {
    return null;
  }
  return num;
}

/**
 * 共通エラーレスポンスハンドラ
 */
function handleControllerError(res: Response, err: unknown, context: string) {
  if (err instanceof ChatServiceError) {
    return res.status(err.statusCode).json({
      status: 'error',
      code: err.code,
      message: err.message,
      details: [],
    });
  }

  console.error(`[Chat Error - ${context}]:`, err);
  return res.status(500).json({
    status: 'error',
    code: 'INTERNAL_ERROR',
    message: 'チャットサーバーで一時的なエラーが発生しました。時間をおいて再試行してください。',
    details: [],
  });
}

export const chatController = {
  /**
   * GET /chat - チャット画面HTML描画
   */
  renderPage(req: Request, res: Response) {
    return res.render('chat/index', { title: 'リアルタイムチャット' });
  },

  /**
   * POST /api/chat/join - 空きルームへの入室・席確保
   */
  async join(req: Request, res: Response) {
    try {
      const result = await chatService.joinRoom();
      return res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      return handleControllerError(res, err, 'join');
    }
  },

  /**
   * GET /api/chat/sync?afterId=0 - 差分メッセージ取得 & Heartbeat更新
   */
  async sync(req: Request, res: Response) {
    try {
      const seatToken = req.header('x-seat-token');
      const afterId = parseNonNegativeInt(req.query.afterId);

      if (afterId === null) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_INPUT',
          message: 'afterId は0以上の整数で指定してください',
          details: [],
        });
      }

      const data = await chatService.syncRoom(seatToken, afterId);
      return res.status(200).json({
        status: 'success',
        data,
      });
    } catch (err) {
      return handleControllerError(res, err, 'sync');
    }
  },

  /**
   * POST /api/chat/messages - メッセージ投稿
   */
  async postMessage(req: Request, res: Response) {
    try {
      const seatToken = req.header('x-seat-token');
      const { userName, comment } = req.body ?? {};

      const message = await chatService.postMessage(seatToken, userName, comment);
      return res.status(201).json({
        status: 'success',
        data: {
          message,
        },
      });
    } catch (err) {
      return handleControllerError(res, err, 'postMessage');
    }
  },

  /**
   * POST /api/chat/leave - 離脱通知（navigator.sendBeacon / fetch 両対応）
   */
  async leave(req: Request, res: Response) {
    try {
      const seatToken =
        req.header('x-seat-token') ||
        (typeof req.query.token === 'string' ? req.query.token : undefined) ||
        (typeof req.body?.token === 'string' ? req.body.token : undefined);

      if (seatToken) {
        await chatService.leaveRoom(seatToken);
        console.log(`[Chat Leave] Seat released: ${seatToken}`);
      }
      return res.status(200).json({
        status: 'success',
      });
    } catch (err) {
      // 離脱通知はページクローズ時のため、ログのみ残して200を返す
      console.error('[Chat Error - leave]:', err);
      return res.status(200).json({
        status: 'success',
      });
    }
  },
};