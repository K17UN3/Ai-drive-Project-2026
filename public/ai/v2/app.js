document.addEventListener('DOMContentLoaded', () => {
  const newChatBtn = document.getElementById('new-chat-btn');
  const conversationListContainer = document.getElementById('conversation-list-container');
  const currentChatTitle = document.getElementById('current-chat-title');
  const turnsContainer = document.getElementById('turns-container');
  const statusArea = document.getElementById('status-area');
  const qaForm = document.getElementById('qa-form');
  const questionInput = document.getElementById('question-input');
  const charCounter = document.getElementById('char-counter');
  const submitBtn = document.getElementById('submit-btn');

  // フロントエンド状態管理
  let conversations = [];
  let activeConversationId = null;
  let currentTurns = [];
  let isBusy = false;

  /**
   * サロゲートペアを考慮したコードポイント長
   */
  function getCodePointLength(str) {
    return Array.from(str).length;
  }

  /**
   * 日時フォーマット
   */
  function formatDate(isoString) {
    try {
      return new Date(isoString).toLocaleString('ja-JP');
    } catch {
      return isoString || '';
    }
  }

  /**
   * ビジー・ロック状態の一括切替（二重送信・切替競合防止）
   */
  function setBusyState(busy, submitLabel = '質問を送信') {
    isBusy = busy;
    if (newChatBtn) {
      newChatBtn.disabled = busy;
      newChatBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    if (questionInput) {
      questionInput.disabled = busy;
      questionInput.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    if (submitBtn) {
      submitBtn.disabled = busy;
      submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
      submitBtn.textContent = submitLabel;
    }
    const convButtons = document.querySelectorAll('.conversation-btn');
    convButtons.forEach((btn) => {
      btn.disabled = busy;
    });
  }

  /**
   * ステータスメッセージ表示（textContentによるXSS安全描画）
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
   * 文字数カウンタの更新
   */
  function updateCharCounter() {
    if (!questionInput || !charCounter) return;
    const len = getCodePointLength(questionInput.value.trim());
    charCounter.textContent = `${len} / 2000 文字`;
  }

  /**
   * 会話一覧の描画（textContent のみ使用）
   */
  function renderConversationList() {
    if (!conversationListContainer) return;
    conversationListContainer.innerHTML = '';

    if (!conversations || conversations.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-conversations';
      emptyDiv.textContent = '保存された会話はありません。';
      conversationListContainer.appendChild(emptyDiv);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'conversation-list';

    conversations.forEach((conv) => {
      const li = document.createElement('li');
      li.className = 'conversation-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'conversation-btn' + (conv.id === activeConversationId ? ' active' : '');
      btn.disabled = isBusy;
      btn.addEventListener('click', () => {
        if (!isBusy && conv.id !== activeConversationId) {
          selectConversation(conv.id);
        }
      });

      const titleDiv = document.createElement('div');
      titleDiv.className = 'conv-title';
      titleDiv.textContent = conv.title || '新しい会話';

      const dateDiv = document.createElement('div');
      dateDiv.className = 'conv-date';
      dateDiv.textContent = formatDate(conv.updatedAt);

      btn.appendChild(titleDiv);
      btn.appendChild(dateDiv);
      li.appendChild(btn);
      ul.appendChild(li);
    });

    conversationListContainer.appendChild(ul);
  }

  /**
   * 選択中の会話の往復履歴を描画（最大20往復・古い順→新しい順）
   */
  function renderTurns() {
    if (!turnsContainer) return;
    turnsContainer.innerHTML = '';

    if (!currentTurns || currentTurns.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-turns';
      emptyDiv.textContent = 'この会話にはまだ履歴がありません。下の入力欄から質問を送信してください。';
      turnsContainer.appendChild(emptyDiv);
      return;
    }

    currentTurns.forEach((turn) => {
      const group = document.createElement('div');
      group.className = 'turn-group';

      // ユーザー質問吹き出し
      const userRow = document.createElement('div');
      userRow.className = 'msg-row user';

      const userLabel = document.createElement('div');
      userLabel.className = 'msg-label';
      userLabel.textContent = `あなた (${formatDate(turn.createdAt)})`;

      const userBubble = document.createElement('div');
      userBubble.className = 'msg-bubble';
      userBubble.textContent = turn.userMessage;

      userRow.appendChild(userLabel);
      userRow.appendChild(userBubble);

      // AI回答吹き出し
      const modelRow = document.createElement('div');
      modelRow.className = 'msg-row model';

      const modelLabel = document.createElement('div');
      modelLabel.className = 'msg-label';
      modelLabel.textContent = 'Gemini AI';

      const modelBubble = document.createElement('div');
      modelBubble.className = 'msg-bubble';
      modelBubble.textContent = turn.modelMessage;

      modelRow.appendChild(modelLabel);
      modelRow.appendChild(modelBubble);

      group.appendChild(userRow);
      group.appendChild(modelRow);
      turnsContainer.appendChild(group);
    });

    // 最新メッセージへスクロール
    turnsContainer.scrollTop = turnsContainer.scrollHeight;
  }

  /**
   * 会話一覧の取得 (`GET /api/ai/v2/conversations`)
   */
  async function fetchConversations() {
    const response = await fetch('/api/ai/v2/conversations');
    const json = await response.json().catch(() => null);

    if (!response.ok || !json || json.status !== 'success' || !json.data) {
      throw new Error((json && json.message) || '会話一覧の取得に失敗しました。');
    }

    conversations = Array.isArray(json.data.conversations) ? json.data.conversations : [];
    renderConversationList();
  }

  /**
   * 指定会話の選択と履歴取得 (`GET /api/ai/v2/conversations/:id/turns`)
   */
  async function selectConversation(conversationId) {
    setBusyState(true);
    showStatus('', 'none');

    try {
      const response = await fetch(`/api/ai/v2/conversations/${conversationId}/turns`);
      const json = await response.json().catch(() => null);

      if (!response.ok || !json || json.status !== 'success' || !json.data) {
        throw new Error((json && json.message) || '会話履歴の取得に失敗しました。');
      }

      activeConversationId = json.data.conversation.id;
      if (currentChatTitle) {
        currentChatTitle.textContent = json.data.conversation.title || '新しい会話';
      }
      currentTurns = Array.isArray(json.data.turns) ? json.data.turns.slice(-20) : [];

      renderConversationList();
      renderTurns();
    } catch (err) {
      console.error('[Select Conversation Error]:', err);
      showStatus(err.message || '会話の読み込みに失敗しました。', 'error');
    } finally {
      setBusyState(false);
    }
  }

  /**
   * 新規会話スレッド作成 (`POST /api/ai/v2/conversations`)
   */
  async function createNewConversationInternal() {
    const response = await fetch('/api/ai/v2/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const json = await response.json().catch(() => null);

    if (!response.ok || !json || json.status !== 'success' || !json.data || !json.data.conversation) {
      throw new Error((json && json.message) || '新しい会話の作成に失敗しました。');
    }

    const newConv = json.data.conversation;
    conversations.unshift(newConv);
    conversations = conversations.slice(0, 20);
    activeConversationId = newConv.id;
    currentTurns = [];

    if (currentChatTitle) {
      currentChatTitle.textContent = newConv.title || '新しい会話';
    }
    renderConversationList();
    renderTurns();

    return newConv;
  }

  /**
   * 「＋ 新しい会話」ボタン押下ハンドラ
   */
  async function handleNewChatClick() {
    if (isBusy) return;
    setBusyState(true);
    showStatus('', 'none');

    try {
      await createNewConversationInternal();
      if (questionInput) {
        questionInput.focus();
      }
    } catch (err) {
      console.error('[New Chat Error]:', err);
      showStatus(err.message || '新規会話の作成に失敗しました。', 'error');
    } finally {
      setBusyState(false);
    }
  }

  /**
   * 質問送信ハンドラ (`POST /api/ai/v2/conversations/:id/turns`)
   */
  async function handleQuestionSubmit(e) {
    e.preventDefault();
    if (isBusy) return;

    const rawInput = questionInput ? questionInput.value : '';
    const trimmedInput = rawInput.trim();
    const len = getCodePointLength(trimmedInput);

    // 入力バリデーション (空白除き1〜2000文字)
    if (len === 0 || len > 2000) {
      showStatus('質問文は空白を除く1文字以上2000文字以内で入力してください。', 'error');
      return;
    }

    setBusyState(true, '回答生成中...');
    showStatus('AIが文脈を踏まえて回答を生成中です...', 'info');

    // ブラウザ側45秒タイムアウト
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      // 未選択状態の場合は先に新しい会話を自動作成
      if (activeConversationId === null) {
        await createNewConversationInternal();
      }

      const targetConvId = activeConversationId;
      const response = await fetch(`/api/ai/v2/conversations/${targetConvId}/turns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({ question: trimmedInput }),
      });

      clearTimeout(timeoutId);

      let json = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        json = await response.json().catch(() => null);
      }

      if (!response.ok || !json || json.status !== 'success' || !json.data || !json.data.turn) {
        const errMsg =
          (json && json.message) || '質問の送信中にエラーが発生しました。時間をおいて再試行してください。';
        // 失敗時は入力欄の文字を消去せず保持する
        showStatus(errMsg, 'error');
        return;
      }

      // 成功時のみ入力欄をクリア
      if (questionInput) {
        questionInput.value = '';
        updateCharCounter();
      }
      showStatus('', 'none');

      // 受信した1往復を画面末尾に追加（最大20往復に維持）
      currentTurns.push(json.data.turn);
      if (currentTurns.length > 20) {
        currentTurns = currentTurns.slice(-20);
      }
      renderTurns();

      // 左一覧のタイトル・更新日時を最新化し、先頭へ移動
      if (json.data.conversation) {
        const updatedConv = json.data.conversation;
        if (currentChatTitle) {
          currentChatTitle.textContent = updatedConv.title || '新しい会話';
        }
        conversations = conversations.filter((c) => c.id !== updatedConv.id);
        conversations.unshift(updatedConv);
        conversations = conversations.slice(0, 20);
        renderConversationList();
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('[Submit Turn Error]:', err);

      if (err.name === 'AbortError') {
        showStatus('通信がタイムアウトしました (45秒)。入力内容は保持されています。再度お試しください。', 'error');
      } else {
        showStatus('ネットワークエラーが発生しました。入力内容は保持されています。接続を確認してください。', 'error');
      }
    } finally {
      // 成功・失敗を問わず操作ロックを必ず解除
      setBusyState(false, '質問を送信');
    }
  }

  /**
   * 初期ロード（リロード復元）
   */
  async function init() {
    setBusyState(true);
    try {
      await fetchConversations();
      // 保存済みの会話が存在する場合は先頭（最新）の会話を選択して履歴を復元
      if (conversations.length > 0) {
        await selectConversation(conversations[0].id);
      } else {
        activeConversationId = null;
        currentTurns = [];
        renderTurns();
      }
    } catch (err) {
      console.error('[Init V2 Error]:', err);
      showStatus(err.message || '初期データの読み込みに失敗しました。', 'error');
    } finally {
      setBusyState(false);
    }
  }

  if (newChatBtn) {
    newChatBtn.addEventListener('click', handleNewChatClick);
  }
  if (qaForm) {
    qaForm.addEventListener('submit', handleQuestionSubmit);
  }
  if (questionInput) {
    questionInput.addEventListener('input', updateCharCounter);
  }

  init();
});