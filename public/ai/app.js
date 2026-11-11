document.addEventListener('DOMContentLoaded', () => {
  const questionInput = document.getElementById('question-input');
  const submitBtn = document.getElementById('submit-btn');
  const statusArea = document.getElementById('status-area');
  const historyContainer = document.getElementById('history-container');

  /**
   * フォームの活性/非活性を切り替える
   * @param {boolean} disabled 
   */
  function setFormDisabled(disabled) {
    if (questionInput) questionInput.disabled = disabled;
    if (submitBtn) submitBtn.disabled = disabled;
  }

  /**
   * ステータスメッセージを表示
   * @param {string} message 
   * @param {'error'|'info'|'none'} type 
   */
  function showStatus(message, type = 'info') {
    if (!statusArea) return;
    statusArea.innerHTML = '';
    if (type === 'none' || !message) return;

    const div = document.createElement('div');
    div.className = `status-msg ${type}`;
    div.textContent = message;
    statusArea.appendChild(div);
  }

  /**
   * 日時文字列のフォーマット
   * @param {string} isoString 
   */
  function formatDate(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('ja-JP');
    } catch {
      return isoString;
    }
  }

  /**
   * 履歴一覧を描画する (textContent等による安全なDOM構築)
   * @param {Array<{id: number, prompt: string, response: string, createdAt: string}>} items 
   */
  function renderHistory(items) {
    historyContainer.innerHTML = '';

    if (!items || items.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent = '過去の質問履歴はありません。';
      historyContainer.appendChild(emptyDiv);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'history-list';

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const header = document.createElement('div');
      header.className = 'history-header';
      header.textContent = `投稿日時: ${formatDate(item.createdAt)}`;

      const promptDiv = document.createElement('div');
      promptDiv.className = 'history-prompt';
      promptDiv.textContent = `Q: ${item.prompt}`;

      const responseDiv = document.createElement('div');
      responseDiv.className = 'history-response';
      responseDiv.textContent = item.response || '(回答なし)';

      li.appendChild(header);
      li.appendChild(promptDiv);
      li.appendChild(responseDiv);
      ul.appendChild(li);
    });

    historyContainer.appendChild(ul);
  }

  /**
   * 初期化：履歴取得 API (`GET /api/ai/history`) の実行
   */
  async function loadHistory() {
    setFormDisabled(true);
    showStatus('', 'none');

    try {
      const response = await fetch('/api/ai/history');
      
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const json = await response.json();

      // レスポンス構造の安全な検証 ({ status: 'success', data: { items: [...] } })
      if (json && json.status === 'success' && json.data && Array.isArray(json.data.items)) {
        renderHistory(json.data.items);
      } else {
        throw new Error('不正なデータ形式を受信しました');
      }
    } catch (err) {
      console.error('[Load History Error]:', err);
      historyContainer.innerHTML = '';
      
      const errorDiv = document.createElement('div');
      errorDiv.className = 'status-msg error';
      errorDiv.textContent = '履歴の取得に失敗しました。';
      historyContainer.appendChild(errorDiv);
    } finally {
      // 成功・失敗を問わず操作可能な状態にアンロック
      setFormDisabled(false);
    }
  }

  // 初期ロード実行
  loadHistory();
});