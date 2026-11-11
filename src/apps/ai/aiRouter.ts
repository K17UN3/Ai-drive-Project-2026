import { Router } from 'express';
import { aiController } from './aiController';

export const aiRouter = Router();

// 画面表示ルート
aiRouter.get('/ai', aiController.renderPage);

// API ルート
aiRouter.post('/api/v1/ai/ask', aiController.askQuestion);