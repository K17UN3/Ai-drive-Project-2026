import { AiServiceError } from '../aiService';

// Gemini API へ渡すマルチターンメッセージ構造
export interface GeminiContentTurn {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export const aiV2Service = {
  /**
   * 過去の文脈（最大5往復）と今回の質問を含む contents 配列から Gemini API で回答を生成する
   * @param contents 時系列昇順の [{ role: 'user'|'model', parts: [{ text }] }, ...]
   * @param conversationId 検証ログ用の会話ID
   */
  async generateTurnAnswer(contents: GeminiContentTurn[], conversationId: number): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AiServiceError('APIキーが設定されていません', 503, 'SERVICE_UNAVAILABLE');
    }

    // 検証用ログ（どの会話IDに対し、何要素・どのロール順で送信するかを確認可能にする）
    console.log(
      `[AI V2 Context Check] conversationId=${conversationId}, totalContents=${contents.length}, roles=[${contents
        .map((c) => c.role)
        .join(' -> ')}]`
    );

    // 利用可能なモデルの優先順位リスト（V1と同じ安定構成）
    const candidateModels = process.env.GEMINI_MODEL
      ? [process.env.GEMINI_MODEL]
      : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

    let lastErrorDetails: unknown = null;

    for (const modelName of candidateModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      // 30秒タイムアウト（自動リトライなし）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents,
            generationConfig: {
              maxOutputTokens: 1024,
            },
          }),
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data: any = await response.json();
          const answerText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

          // 空回答は失敗とみなす（DBに不完全データを保存させない）
          if (!answerText) {
            throw new AiServiceError('AIからの回答が空でした', 502, 'EMPTY_RESPONSE');
          }

          return answerText;
        }

        const errorBody: any = await response.json().catch(() => ({}));
        lastErrorDetails = {
          model: modelName,
          status: response.status,
          statusText: response.statusText,
          error: errorBody.error || errorBody,
        };
        console.error(`[Gemini V2 API Failed - ${modelName}]:`, JSON.stringify(lastErrorDetails, null, 2));
      } catch (err: any) {
        clearTimeout(timeoutId);

        if (err instanceof AiServiceError) {
          throw err;
        }

        if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('timeout')) {
          throw new AiServiceError('AI APIの呼び出しがタイムアウトしました (30秒)', 504, 'GATEWAY_TIMEOUT');
        }

        console.error(`[Gemini V2 Network Error - ${modelName}]:`, err.message || err);
        lastErrorDetails = err;
      }
    }

    console.error('[Gemini V2 All Models Failed]:', JSON.stringify(lastErrorDetails, null, 2));
    throw new AiServiceError(
      'AI回答生成中にエラーが発生しました。時間をおいて再試行してください。',
      500,
      'GEMINI_API_ERROR'
    );
  },
};