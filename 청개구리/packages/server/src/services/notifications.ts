// 알림: DB 아웃박스(notifications)에 쌓고 발송기로 보낸다.
// - 사용자 설정(notification_preferences)에 따라 발송 여부 결정
// - 같은 사용자·같은 유형 알림은 3시간에 1회로 제한 (예약 관련 거래성 알림은 제외)

import { HOUR } from '@cheong/core';
import { requireActor, type Actor, type Ctx } from '../context';
import type { Queryable } from '../db';
import { validation } from '../errors';

export type NotificationCategory = 'rain' | 'favorite' | 'typhoon' | 'reservation' | 'owner';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSender {
  readonly mode: 'mock' | 'expo';
  send(messages: PushMessage[]): Promise<Array<{ ok: boolean; error?: string }>>;
}

/** 개발용: 실제로 보내지 않고 성공으로 기록 (status = SENT_MOCK) */
export class MockPushSender implements PushSender {
  readonly mode = 'mock' as const;
  readonly sent: PushMessage[] = [];
  async send(messages: PushMessage[]) {
    this.sent.push(...messages);
    return messages.map(() => ({ ok: true }));
  }
}

/** Expo Push API. 앱에서 받은 ExponentPushToken 이 있어야 한다. (EAS 프로젝트 설정 필요) */
export class ExpoPushSender implements PushSender {
  readonly mode = 'expo' as const;
  constructor(private accessToken?: string) {}
  async send(messages: PushMessage[]) {
    if (messages.length === 0) return [];
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(messages.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default' }))),
    });
    if (!res.ok) return messages.map(() => ({ ok: false, error: `HTTP ${res.status}` }));
    const json = (await res.json()) as { data?: Array<{ status: string; message?: string }> };
    return messages.map((_, i) => {
      const d = json.data?.[i];
      return d?.status === 'ok' ? { ok: true } : { ok: false, error: d?.message ?? 'unknown' };
    });
  }
}

const THROTTLE_MS = 3 * HOUR;
const PREF_COLUMN: Record<NotificationCategory, string | null> = {
  rain: 'rain_alerts',
  favorite: 'favorite_alerts',
  typhoon: 'typhoon_alerts',
  reservation: 'reservation_alerts',
  owner: null, // 점주 운영 알림은 항상 (인앱)
};

export interface EnqueueInput {
  userId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
}

/** 알림을 큐에 넣는다. 설정 OFF / 빈도 제한이면 넣지 않고 false */
export async function enqueueNotification(q: Queryable, now: Date, n: EnqueueInput): Promise<boolean> {
  const col = PREF_COLUMN[n.category];
  if (col) {
    const [p] = await q.query<{ on: boolean }>(`select ${col} as on from notification_preferences where user_id = $1`, [n.userId]);
    if (p && !p.on) return false;
  }
  if (n.dedupeKey) {
    const dup = await q.query(`select 1 from notifications where user_id = $1 and dedupe_key = $2 and created_at > $3`, [
      n.userId,
      n.dedupeKey,
      new Date(now.getTime() - 24 * HOUR),
    ]);
    if (dup.length) return false;
  }
  if (n.category !== 'reservation' && n.category !== 'owner') {
    const recent = await q.query(`select 1 from notifications where user_id = $1 and type = $2 and created_at > $3 limit 1`, [
      n.userId,
      n.type,
      new Date(now.getTime() - THROTTLE_MS),
    ]);
    if (recent.length) return false;
  }
  await q.query(
    `insert into notifications (user_id, type, title, body, data, dedupe_key, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
    [n.userId, n.type, n.title, n.body, n.data ? JSON.stringify(n.data) : null, n.dedupeKey ?? null, now],
  );
  return true;
}

/** 큐에 쌓인 알림 발송. 푸시 토큰이 없으면 인앱 알림으로만 남긴다. */
export async function dispatchNotifications(ctx: Ctx, limit = 200) {
  const rows = await ctx.db.query<{ id: string; title: string; body: string; data: Record<string, unknown> | null; push_token: string | null }>(
    `select n.id, n.title, n.body, n.data, p.push_token
       from notifications n left join notification_preferences p on p.user_id = n.user_id
      where n.status = 'QUEUED' order by n.created_at limit $1`,
    [limit],
  );
  const withToken = rows.filter((r) => r.push_token);
  const results = ctx.config.pushMode === 'mock' ? withToken.map(() => ({ ok: true })) : await ctx.push.send(
    withToken.map((r) => ({ to: r.push_token!, title: r.title, body: r.body, data: r.data ?? undefined })),
  );
  const now = ctx.now();
  for (const [i, r] of withToken.entries()) {
    const ok = results[i]?.ok;
    const status = ok ? (ctx.config.pushMode === 'mock' ? 'SENT_MOCK' : 'SENT') : 'FAILED';
    await ctx.db.query(`update notifications set status = $2, sent_at = $3 where id = $1`, [r.id, status, now]);
  }
  for (const r of rows.filter((r) => !r.push_token)) {
    await ctx.db.query(`update notifications set status = 'SENT', channel = 'IN_APP', sent_at = $2 where id = $1`, [r.id, now]);
  }
  return { processed: rows.length, pushed: withToken.length };
}

export async function listMyNotifications(ctx: Ctx, actor: Actor | null) {
  const a = requireActor(actor);
  return ctx.db.query(
    `select id, type, title, body, data, created_at as "createdAt", read_at as "readAt", status
       from notifications where user_id = $1 order by created_at desc limit 50`,
    [a.userId],
  );
}

export async function markNotificationsRead(ctx: Ctx, actor: Actor | null) {
  const a = requireActor(actor);
  await ctx.db.query(`update notifications set read_at = $2 where user_id = $1 and read_at is null`, [a.userId, ctx.now()]);
}

export async function getPreferences(ctx: Ctx, actor: Actor | null) {
  const a = requireActor(actor);
  const [p] = await ctx.db.query(
    `select rain_alerts as "rainAlerts", favorite_alerts as "favoriteAlerts", typhoon_alerts as "typhoonAlerts",
            reservation_alerts as "reservationAlerts", marketing, (push_token is not null) as "pushRegistered"
       from notification_preferences where user_id = $1`,
    [a.userId],
  );
  return p;
}

export async function updatePreferences(
  ctx: Ctx,
  actor: Actor | null,
  input: Partial<{ rainAlerts: boolean; favoriteAlerts: boolean; typhoonAlerts: boolean; reservationAlerts: boolean; marketing: boolean; pushToken: string | null }>,
) {
  const a = requireActor(actor);
  const map: Record<string, string> = {
    rainAlerts: 'rain_alerts',
    favoriteAlerts: 'favorite_alerts',
    typhoonAlerts: 'typhoon_alerts',
    reservationAlerts: 'reservation_alerts',
    marketing: 'marketing',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === 'boolean') {
      await ctx.db.query(`update notification_preferences set ${col} = $2, updated_at = now() where user_id = $1`, [a.userId, v]);
    }
  }
  if (input.pushToken !== undefined) {
    const t = input.pushToken;
    if (t !== null && !/^Expo(nent)?PushToken\[[^\]]+\]$/.test(t)) {
      throw validation('푸시 토큰 형식이 올바르지 않아요.');
    }
    await ctx.db.query(`update notification_preferences set push_token = $2, updated_at = now() where user_id = $1`, [a.userId, t]);
  }
  return getPreferences(ctx, a);
}
