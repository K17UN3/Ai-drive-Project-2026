document.addEventListener('DOMContentLoaded', () => {
  // DOM要素参照
  const roomStatusEl = document.getElementById('room-status');
  const errorBannerEl = document.getElementById('error-banner');
  const loadingViewEl = document.getElementById('loading-view');
  const fullWaitViewEl = document.getElementById('full-wait-view');
  const chatMainViewEl = document.getElementById('chat-main-view');
  const messageListEl = document.getElementById('message-list');
  const chatFormEl = document.getElementById('chat-form');
  const userNameInputEl = document.getElementById('user-name-input');
  const commentInputEl = document.getElementById('comment-input');
  const sendButtonEl = document.getElementById('send-button');

  // クライアント状態管理
  let seatToken = null;
  let lastMessageId = 0;
  let pollingTimer = null;
  let isSubmitting = false;
  let leaveSent = false;
  const renderedMessageIds = new Set();

  const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

  // エラーメッセージ表示制御
  function showError(msg) {
    if (!msg) {
      errorBannerEl.textContent = '';
      errorBannerEl.classList.add('hidden');
      return;
    }
    errorBannerEl.textContent = msg;
    errorBannerEl.classList.remove('hidden');
  }

  // 画面モード切り替え（loading / full / chat）
  function switchView(mode) {
    loadingViewEl.classList.add('hidden');
    fullWaitViewEl.classList.add('hidden');
    chatMainViewEl.classList.add('hidden');

    if (mode === 'loading') loadingViewEl.classList.remove('hidden');
    if (mode === 'full') fullWaitViewEl.classList.remove('hidden');
    if (mode === 'chat') chatMainViewEl.classList.remove('hidden');
  }

  // 単一タイマーによる次のポーリング予約（多重実行防止）
  function scheduleNext(fn, delayMs) {
    if (pollingTimer) clearTimeout(pollingTimer);
    pollingTimer = setTimeout(fn, delayMs);
  }

  // セッション状態のリセット（再入室用）
  function resetSessionState() {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    seatToken = null;
    leaveSent = false;
    lastMessageId = 0;
    renderedMessageIds.clear();
    messageListEl.textContent = '';
  }

  // XSS安全なメッセージ描画（textContentのみ使用・ID重複排除）
  function renderMessage(msg) {
    if (renderedMessageIds.has(msg.id)) return;
    renderedMessageIds.add(msg.id);

    if (msg.id > lastMessageId) {
      lastMessageId = msg.id;
    }

    const item = document.createElement('div');
    item.className = 'chat-item';

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const timeStr = new Date(msg.createdAt).toLocaleTimeString('ja-JP');
    meta.textContent = `${msg.userName} (${timeStr})`;

    const body = document.createElement('p');
    body.className = 'chat-body';
    body.textContent = msg.comment;

    item.appendChild(meta);
    item.appendChild(body);
    messageListEl.appendChild(item);

    // 画面上の表示件数が20件を超えたら古い要素を削除
    while (messageListEl.children.length > 20) {
      messageListEl.removeChild(messageListEl.firstChild);
    }

    messageListEl.scrollTop = messageListEl.scrollHeight;
  }

  // 1. 入室試行（POST /api/chat/join）
  async function joinRoom() {
    try {
      const res = await fetch('/api/chat/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: '{}',
      });
      const json = await res.json();

      if (!res.ok || json.status !== 'success') {
        throw new Error(json.message || '入室処理に失敗しました');
      }

      showError(null);

      // 全室満席の場合：待機画面を表示し3秒後に再試行
      if (!json.data.joined) {
        roomStatusEl.textContent = '全室満席 (待機中)';
        switchView('full');
        scheduleNext(joinRoom, json.data.retryAfterMs || 3000);
        return;
      }

      // 入室成功
      seatToken = json.data.seatToken;
      leaveSent = false;
      roomStatusEl.textContent = `${json.data.roomName} (${json.data.activeCount} / ${json.data.maxCapacity} 人)`;
      switchView('chat');

      // 初期履歴（最新20件・昇順）を描画
      (json.data.messages || []).forEach(renderMessage);

      // 1.5秒間隔の定期同期・Heartbeatを開始
      scheduleNext(syncRoom, 1500);
    } catch (err) {
      console.error('[Join Error]:', err);
      showError('サーバーに接続できません。5秒後に再試行します...');
      scheduleNext(joinRoom, 5000);
    }
  }

  // 2. 定期同期・Heartbeat（GET /api/chat/sync）
  async function syncRoom() {
    if (!seatToken) {
      joinRoom();
      return;
    }

    try {
      const res = await fetch(`/api/chat/sync?afterId=${encodeURIComponent(lastMessageId)}`, {
        headers: { 'x-seat-token': seatToken },
        cache: 'no-store',
      });

      // タイムアウト等で席失効（401）した場合は自動再入室
      if (res.status === 401) {
        resetSessionState();
        switchView('loading');
        roomStatusEl.textContent = '再入室中...';
        joinRoom();
        return;
      }

      const json = await res.json();
      if (!res.ok || json.status !== 'success') {
        throw new Error(json.message || '同期エラーが発生しました');
      }

      showError(null);
      // サーバー側の最新参加人数をリアルタイム反映
      roomStatusEl.textContent = `${json.data.roomName} (${json.data.activeCount} / ${json.data.maxCapacity} 人)`;
      (json.data.messages || []).forEach(renderMessage);

      scheduleNext(syncRoom, 1500);
    } catch (err) {
      console.error('[Sync Error]:', err);
      showError('通信が不安定です。再接続を試みています...');
      scheduleNext(syncRoom, 4000);
    }
  }

  // 3. 投稿送信（初期化時に1回だけイベント登録）
  chatFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting || !seatToken) return;

    const trimBoth = (s) => s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    const userName = trimBoth(userNameInputEl.value);
    const normalizedComment = trimBoth(commentInputEl.value.replace(/\r\n?/g, '\n')).replace(/\n{2,}/g, '\n');

    // クライアント側バリデーション
    const userNameLen = Array.from(userName).length;
    if (userNameLen < 1 || userNameLen > 20) {
      showError('ユーザー名は1文字以上20文字以内で入力してください');
      return;
    }
    if (EMOJI_REGEX.test(userName)) {
      showError('ユーザー名に絵文字は使用できません');
      return;
    }
    const commentLen = Array.from(normalizedComment).length;
    if (commentLen < 1 || commentLen > 500) {
      showError('コメントは1文字以上500文字以内で入力してください');
      return;
    }

    isSubmitting = true;
    sendButtonEl.disabled = true;
    showError(null);

    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-seat-token': seatToken,
        },
        body: JSON.stringify({ userName, comment: normalizedComment }),
      });

      if (res.status === 401) {
        resetSessionState();
        switchView('loading');
        joinRoom();
        return;
      }

      const json = await res.json();
      if (!res.ok || json.status !== 'success') {
        showError(json.message || 'メッセージの送信に失敗しました');
        return;
      }

      // 送信成功：自メッセージを即座に描画し、コメント欄のみクリア（ユーザー名は保持）
      renderMessage(json.data.message);
      commentInputEl.value = '';
    } catch (err) {
      console.error('[Post Error]:', err);
      showError('通信エラーのため送信できませんでした。内容を確認して再送信してください。');
    } finally {
      isSubmitting = false;
      sendButtonEl.disabled = false;
    }
  });

  // 4. タブクローズ・遷移時の席解放通知（多重送信防止付き・確実送信）
  function notifyLeaveSeat() {
    if (!seatToken || leaveSent) return;
    leaveSent = true;

    // 進行中の同期ポーリングを即座に停止（退室後の復活防止）
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }

    const tokenToRelease = seatToken;
    seatToken = null;
    const url = `/api/chat/leave?token=${encodeURIComponent(tokenToRelease)}`;

    // sendBeacon で確実に送信（非対応環境のみ keepalive fetch）
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, '');
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'x-seat-token': tokenToRelease },
        keepalive: true,
      }).catch(() => {});
    }
  }

  window.addEventListener('pagehide', notifyLeaveSeat);
  window.addEventListener('beforeunload', notifyLeaveSeat);

  // 起動開始
  joinRoom();
});