export const aiService = {
  /**
   * 質問テキストからAI回答を生成する関数
   * 【ローカル検証用モック設定】
   * TASK-04 で実 Gemini API SDK に置き換える対象は、この関数内のモック返却ロジックです。
   */
  async generateAnswer(question: string): Promise<string> {
    // 入力文字列の整形
    const trimmed = question.trim();

    // 接続確認用の模擬回答（モック）を返却
    // TASK-04 では、ここを Gemini SDK (@google/genai) 呼び出し処理に変更します
    return `[接続確認用の模擬回答] ご質問「${trimmed}」を受け付けました。AI機能のモック疎通は正常です。`;
  },
};