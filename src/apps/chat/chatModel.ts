import crypto from 'crypto';
import { pool } from '../../../db';

export interface ChatMessageItem {
  id: number;
  roomId: number;
  userName: string;
  comment: string;
  createdAt: string;
}

export type JoinRoomResult =
  | {
      joined: true;
      roomId: number;
      roomName: string;
      seatToken: string;
      activeCount: number;
      maxCapacity: number;
      messages: ChatMessageItem[];
    }
  | {
      joined: false;
      retryAfterMs: number;
    };

export interface SyncRoomResult {
  valid: boolean;
  roomId?: number;
  roomName?: string;
  activeCount?: number;
  maxCapacity?: number;
  messages?: ChatMessageItem[];
}

interface DbMessageRow {
  id: string | number;
  room_id: string | number;
  user_name: string;
  comment: string;
  created_at: Date;
}

const formatMessage = (row: DbMessageRow): ChatMessageItem => ({
  id: Number(row.id),
  roomId: Number(row.room_id),
  userName: row.user_name,
  comment: row.comment,
  createdAt: new Date(row.created_at).toISOString(),
});

export const chatModel = {
  /**
   * 空きルームへ参加（席確保）＋最新20件の履歴取得
   * 全3ルーム行ロック(FOR UPDATE)により、複数インスタンス同時アクセス時でも定員5名を厳守する
   */
  async joinAvailableRoom(): Promise<JoinRoomResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 全ルームを行ロックして同時入室を直列化
      const roomsRes = await client.query<{
        id: number;
        name: string;
        max_capacity: number;
      }>('SELECT id, name, max_capacity FROM chat_rooms ORDER BY id ASC FOR UPDATE;');

      // 2. 45秒以上通信がない失効済みの席を回収
      await client.query(
        "DELETE FROM chat_seats WHERE last_seen_at < NOW() - INTERVAL '45 seconds';"
      );

      // 3. ルームごとの現在の有効参加人数を集計
      const countsRes = await client.query<{ room_id: number; cnt: number }>(
        'SELECT room_id, COUNT(*)::int AS cnt FROM chat_seats GROUP BY room_id;'
      );
      const countMap = new Map<number, number>(
        countsRes.rows.map((r) => [Number(r.room_id), Number(r.cnt)])
      );

      // 4. 空きがある最初のルームを検索
      const targetRoom = roomsRes.rows.find(
        (r) => (countMap.get(Number(r.id)) ?? 0) < Number(r.max_capacity)
      );

      // 全室満席の場合
      if (!targetRoom) {
        await client.query('COMMIT');
        return {
          joined: false,
          retryAfterMs: 3000,
        };
      }

      // 5. 新規席トークンを発行して挿入
      const seatToken = crypto.randomUUID();
      await client.query(
        'INSERT INTO chat_seats (seat_token, room_id, last_seen_at) VALUES ($1, $2, NOW());',
        [seatToken, targetRoom.id]
      );

      // 6. 入室先ルームの最新20件を取得（降順取得後に反転して古い順→新しい順にする）
      const messagesRes = await client.query<DbMessageRow>(
        `
        SELECT id, room_id, user_name, comment, created_at
        FROM chat_messages
        WHERE room_id = $1
        ORDER BY id DESC
        LIMIT 20;
        `,
        [targetRoom.id]
      );

      await client.query('COMMIT');

      const currentCount = (countMap.get(Number(targetRoom.id)) ?? 0) + 1;
      return {
        joined: true,
        roomId: Number(targetRoom.id),
        roomName: targetRoom.name,
        seatToken,
        activeCount: currentCount,
        maxCapacity: Number(targetRoom.max_capacity),
        messages: messagesRes.rows.reverse().map(formatMessage),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * 定期同期・Heartbeat更新・差分メッセージ取得
   * seatToken が有効（45秒以内）な場合のみ last_seen_at を更新し、afterId より新しいメッセージを返す
   */
  async syncRoomAndHeartbeat(seatToken: string, afterId: number): Promise<SyncRoomResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 期限切れ席のクリーンアップ
      await client.query(
        "DELETE FROM chat_seats WHERE last_seen_at < NOW() - INTERVAL '45 seconds';"
      );

      // 2. 自身の席を更新しつつ所属ルーム情報を取得
      const seatRes = await client.query<{
        room_id: number;
        room_name: string;
        max_capacity: number;
      }>(
        `
        UPDATE chat_seats s
        SET last_seen_at = NOW()
        FROM chat_rooms r
        WHERE s.seat_token = $1
          AND s.room_id = r.id
        RETURNING r.id AS room_id, r.name AS room_name, r.max_capacity;
        `,
        [seatToken]
      );

      // 席が存在しない、またはタイムアウト失効済みの場合
      if (seatRes.rows.length === 0) {
        await client.query('COMMIT');
        return { valid: false };
      }

      const room = seatRes.rows[0];

      // 3. 現在の同室参加人数を取得
      const countRes = await client.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM chat_seats WHERE room_id = $1;',
        [room.room_id]
      );

      // 4. afterId より大きい新着メッセージを取得（初回等で afterId=0 の場合は最新20件を昇順で返す）
      let messages: ChatMessageItem[] = [];
      if (afterId > 0) {
        const diffRes = await client.query<DbMessageRow>(
          `
          SELECT id, room_id, user_name, comment, created_at
          FROM chat_messages
          WHERE room_id = $1 AND id > $2
          ORDER BY id ASC
          LIMIT 50;
          `,
          [room.room_id, afterId]
        );
        messages = diffRes.rows.map(formatMessage);
      } else {
        const latestRes = await client.query<DbMessageRow>(
          `
          SELECT id, room_id, user_name, comment, created_at
          FROM chat_messages
          WHERE room_id = $1
          ORDER BY id DESC
          LIMIT 20;
          `,
          [room.room_id]
        );
        messages = latestRes.rows.reverse().map(formatMessage);
      }

      await client.query('COMMIT');

      return {
        valid: true,
        roomId: Number(room.room_id),
        roomName: room.room_name,
        activeCount: Number(countRes.rows[0]?.cnt ?? 1),
        maxCapacity: Number(room.max_capacity),
        messages,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * メッセージの保存と1ルーム最大50件の維持（席の有効性検証込み）
   */
  async postMessageWithSeatCheck(
    seatToken: string,
    userName: string,
    comment: string
  ): Promise<{ valid: boolean; message?: ChatMessageItem }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 期限切れ席のクリーンアップ
      await client.query(
        "DELETE FROM chat_seats WHERE last_seen_at < NOW() - INTERVAL '45 seconds';"
      );

      // 2. 席の有効確認と last_seen_at 更新
      const seatRes = await client.query<{ room_id: number }>(
        `
        UPDATE chat_seats
        SET last_seen_at = NOW()
        WHERE seat_token = $1
        RETURNING room_id;
        `,
        [seatToken]
      );

      if (seatRes.rows.length === 0) {
        await client.query('COMMIT');
        return { valid: false };
      }

      const roomId = Number(seatRes.rows[0].room_id);

      // 3. 新規メッセージを保存
      const insertRes = await client.query<DbMessageRow>(
        `
        INSERT INTO chat_messages (room_id, user_name, comment)
        VALUES ($1, $2, $3)
        RETURNING id, room_id, user_name, comment, created_at;
        `,
        [roomId, userName, comment]
      );

      // 4. 同一ルームの保存件数を最新50件までに制限（超過した古い行を削除）
      await client.query(
        `
        DELETE FROM chat_messages
        WHERE room_id = $1
          AND id NOT IN (
            SELECT id FROM chat_messages
            WHERE room_id = $1
            ORDER BY id DESC
            LIMIT 50
          );
        `,
        [roomId]
      );

      await client.query('COMMIT');

      return {
        valid: true,
        message: formatMessage(insertRes.rows[0]),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * 離脱時の席解放
   */
  async releaseSeat(seatToken: string): Promise<void> {
    await pool.query('DELETE FROM chat_seats WHERE seat_token = $1;', [seatToken]);
  },
};