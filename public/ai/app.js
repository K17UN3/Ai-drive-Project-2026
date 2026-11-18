document.addEventListener('DOMContentLoaded', () => {
  const qaForm = document.getElementById('qa-form');
  const questionInput = document.getElementById('question-input');
  const submitBtn = document.getElementById('submit-btn');
  const statusArea = document.getElementById('status-area');
  const historyContainer = document.getElementById('history-container');

  // メモリ上で履歴データ（最大20件）を保持
  let historyItems = [];
  let isSubmitting = false;

  /**
   * サロゲートペアを正しく考慮したコードポイント数のカウント
   * @param {string} str 
   * @returns {number}
   */
  function getCodePointLength(str) {
    return Array.from(str).length;
  }

  /**
   * フォームの活性/非活性およびビジー状態を切り替える
   * @param {boolean} disabled 
   * @param {boolean} busy 
   */
  function setFormState(disabled, busy = false) {
    if (questionInput) {
      questionInput.disabled = disabled;
      questionInput.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    if (submitBtn) {
      submitBtn.disabled = disabled;
      submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
      submitBtn.textContent = busy ? '回答生成中...' : '質問を送信';
    }
  }

  /**
   * ステータスメッセージを表示
   * @param {string} message 
   * @param {'error'|'info'|'success'|'none'} type 
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
   * 履歴一覧を描画する (textContent等による安全なDOM構築・XSS対策)
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
    setFormState(true, false);
    showStatus('', 'none');

    try {
      const response = await fetch('/api/ai/history');
      
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const json = await response.json();

      if (json && json.status === 'success' && json.data && Array.isArray(json.data.items)) {
        historyItems = json.data.items.slice(0, 20);
        renderHistory(historyItems);
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
      setFormState(false, false);
    }
  }

  /**
   * 質問送信処理 (`POST /api/ai/ask`)
   * @param {Event} e 
   */
  async function handleQuestionSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const rawInput = questionInput ? questionInput.value : '';
    const trimmedInput = rawInput.trim();
    const length = getCodePointLength(trimmedInput);

    // 入力検証: 前後空白除き1〜2000文字
    if (length === 0 || length > 2000) {
      showStatus('質問文は空白を除く1文字以上2000文字以内で入力してください。', 'error');
      return;
    }

    isSubmitting = true;
    setFormState(true, true);
    showStatus('AIが回答を生成中です。しばらくお待ちください...', 'info');

    // ブラウザ側45秒タイムアウト設定
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({ question: trimmedInput }),
      });

      clearTimeout(timeoutId);

      // JSONまたはHTMLエラーの安全な解析
      let json = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        json = await response.json().catch(() => null);
      }

      // HTTP ステータスおよび応答構造判定
      if (!response.ok || !json || json.status !== 'success' || !json.data) {
        const errorMsg = (json && json.message)
          ? json.message
          : '質問の送信中にエラーが発生しました。時間をおいて再試行してください。';
        showStatus(errorMsg, 'error');
        return;
      }

      // 成功時処理: 質問入力欄を消去
      if (questionInput) {
        questionInput.value = '';
      }
      showStatus('回答の取得に成功しました。', 'none');

      // 新規対話ログを先頭に追加し最大20件に維持
      const newLog = {
        id: json.data.id || Date.now(),
        prompt: trimmedInput,
        response: json.data.answer || '',
        createdAt: json.data.askedAt || new Date().toISOString(),
      };

      historyItems.unshift(newLog);
      historyItems = historyItems.slice(0, 20);
      renderHistory(historyItems);

    } catch (err) {
      clearTimeout(timeoutId);
      console.error('[Ask Question Error]:', err);

      if (err.name === 'AbortError') {
        showStatus('通信がタイムアウトしました (45秒)。時間をおいて再度お試しください。', 'error');
      } else {
        showStatus('ネットワークエラーが発生しました。接続を確認してください。', 'error');
      }
    } finally {
      isSubmitting = false;
      // 通信・パース完了後は必ずボタン・入力欄を復帰させる
      setFormState(false, false);
    }
  }

  // フォーム送信イベント登録
  if (qaForm) {
    qaForm.addEventListener('submit', handleQuestionSubmit);
  }

  // 初期ロード実行
  loadHistory();
});