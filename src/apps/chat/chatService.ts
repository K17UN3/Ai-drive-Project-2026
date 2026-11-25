import { chatModel, ChatMessageItem, JoinRoomResult, SyncRoomResult } from './chatModel';

export class ChatServiceError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'ChatServiceError';
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

/**
 * 前後の半角・全角スペース・タブ・改行を除去
 */
function trimSpaces(value: string): string {
  return value.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
}

/**
 * 席トークン（UUID形式）の検証
 */
function assertValidSeatToken(rawToken: unknown): string {
  if (typeof rawToken !== 'string' || !UUID_REGEX.test(rawToken.trim())) {
    throw new ChatServiceError(
      '参加セッションが無効または期限切れです。再入室してください。',
      401,
      'SEAT_EXPIRED'
    );
  }
  return rawToken.trim();
}

/**
 * ユーザー名・コメントの入力検証と正規化
 */
export function validateAndNormalizeMessageInput(
  rawUserName: unknown,
  rawComment: unknown
): { userName: string; comment: string } {
  if (typeof rawUserName !== 'string' || typeof rawComment !== 'string') {
    throw new ChatServiceError(
      'ユーザー名とコメントは文字列で指定してください',
      400,
      'INVALID_INPUT'
    );
  }

  // ユーザー名検証（前後空白除去後 1〜20文字、絵文字不可）
  const userName = trimSpaces(rawUserName);
  const userNameLen = Array.from(userName).length;
  if (userNameLen < 1 || userNameLen > 20) {
    throw new ChatServiceError(
      'ユーザー名は空白を除く1文字以上20文字以内で入力してください',
      400,
      'VALIDATION_ERROR'
    );
  }
  if (EMOJI_REGEX.test(userName)) {
    throw new ChatServiceError(
      'ユーザー名に絵文字は使用できません',
      400,
      'VALIDATION_ERROR'
    );
  }

  // コメント検証・正規化（前後空白除去、連続改行は1回の \n へ自動変換、1〜500文字）
  const unifiedNewlines = rawComment.replace(/\r\n?/g, '\n');
  const trimmedComment = trimSpaces(unifiedNewlines);
  const normalizedComment = trimmedComment.replace(/\n{2,}/g, '\n');

  const commentLen = Array.from(normalizedComment).length;
  if (commentLen < 1 || commentLen > 500) {
    throw new ChatServiceError(
      'コメントは空白を除く1文字以上500文字以内で入力してください',
      400,
      'VALIDATION_ERROR'
    );
  }

  return {
    userName,
    comment: normalizedComment,
  };
}

export const chatService = {
  /**
   * ルーム入室処理
   */
  async joinRoom(): Promise<JoinRoomResult> {
    return await chatModel.joinAvailableRoom();
  },

  /**
   * 同期・Heartbeat処理
   */
  async syncRoom(rawToken: unknown, afterId: number): Promise<Required<Omit<SyncRoomResult, 'valid'>>> {
    const seatToken = assertValidSeatToken(rawToken);
    const result = await chatModel.syncRoomAndHeartbeat(seatToken, afterId);

    if (!result.valid) {
      throw new ChatServiceError(
        '接続がタイムアウトしたため席が解放されました。再入室します。',
        401,
        'SEAT_EXPIRED'
      );
    }

    return {
      roomId: result.roomId!,
      roomName: result.roomName!,
      activeCount: result.activeCount!,
      maxCapacity: result.maxCapacity!,
      messages: result.messages ?? [],
    };
  },

  /**
   * メッセージ投稿処理
   */
  async postMessage(
    rawToken: unknown,
    rawUserName: unknown,
    rawComment: unknown
  ): Promise<ChatMessageItem> {
    const seatToken = assertValidSeatToken(rawToken);
    const { userName, comment } = validateAndNormalizeMessageInput(rawUserName, rawComment);

    const saved = await chatModel.postMessageWithSeatCheck(seatToken, userName, comment);
    if (!saved.valid || !saved.message) {
      throw new ChatServiceError(
        '参加セッションが無効または期限切れです。再入室してください。',
        401,
        'SEAT_EXPIRED'
      );
    }

    return saved.message;
  },

  /**
   * 離脱処理（不正トークン時は例外にせず安全に無視）
   */
  async leaveRoom(rawToken: unknown): Promise<void> {
    if (typeof rawToken !== 'string' || !UUID_REGEX.test(rawToken.trim())) {
      return;
    }
    await chatModel.releaseSeat(rawToken.trim());
  },
};