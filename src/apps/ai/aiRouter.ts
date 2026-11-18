import { Router } from 'express';
import { aiController } from './aiController';

export const aiRouter = Router();

// 画面表示ルート (GET /ai)
aiRouter.get('/', aiController.renderPage);

// API ルート (POST /api/ai/ask, GET /api/ai/history)
aiRouter.post('/ask', aiController.askQuestion);
aiRouter.get('/history', aiController.getHistory);