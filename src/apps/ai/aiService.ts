import { GoogleGenAI } from '@google/genai';

/**
 * カスタムエラー定義
 */
export class AiServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'AI_SERVICE_ERROR'
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

export const aiService = {
  /**
   * 質問テキストからGemini APIを用いて回答を生成する関数
   */
  async generateAnswer(question: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AiServiceError('APIキーが設定されていません', 503, 'SERVICE_UNAVAILABLE');
    }

    // デフォルトモデルとして gemini-2.5-flash を利用
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    // GoogleGenAI クライアントの初期化 (再試行回数1回制限: fetchOptions / httpOptions)
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        // SDK内部の自動再試行上限を設定 (環境に応じて最大1回に制限)
        apiVersion: 'v1beta',
      },
    });

    // 30秒タイムアウト用の AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // 過去履歴は含めず、単発質問のみ送信
      const response = await ai.models.generateContent({
        model: modelName,
        contents: question.trim(),
        config: {
          maxOutputTokens: 1024,
        },
      });

      clearTimeout(timeoutId);

      const answerText = response.text ? response.text.trim() : '';

      // 空回答は失敗とみなす
      if (!answerText) {
        throw new AiServiceError('AIからの回答が空でした', 502, 'EMPTY_RESPONSE');
      }

      return answerText;
    } catch (err: any) {
      clearTimeout(timeoutId);

      // カスタムエラーの再送出
      if (err instanceof AiServiceError) {
        throw err;
      }

      // タイムアウト検知
      if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('timeout')) {
        throw new AiServiceError('AI APIの呼び出しがタイムアウトしました (30秒)', 504, 'GATEWAY_TIMEOUT');
      }

      // 生例外を隠蔽し安全なエラーコード構造に変換
      console.error('[Gemini API Connection Error]:', err.message || err);
      throw new AiServiceError(
        'AI回答生成中にエラーが発生しました。時間をおいて再試行してください。',
        500,
        'GEMINI_API_ERROR'
      );
    }
  },
};