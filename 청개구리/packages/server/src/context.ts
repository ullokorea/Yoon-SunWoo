import type { Role } from '@cheong/core';
import type { Db, Queryable } from './db';
import { forbidden, unauthorized } from './errors';
import type { WeatherAdapter } from './weather/adapters';
import type { PushSender } from './services/notifications';

export interface ServerConfig {
  env: 'development' | 'test' | 'production';
  /** QR 서명 비밀키 (서버 전용) */
  qrSecret: string;
  /** 'mock' 이면 Mock 날씨 시나리오 사용 */
  weatherSource: 'mock' | 'kma';
  pushMode: 'mock' | 'expo';
  sessionTtlDays: number;
}

export interface Ctx {
  db: Db;
  config: ServerConfig;
  weather: WeatherAdapter;
  push: PushSender;
  now: () => Date;
}

export interface Actor {
  userId: string;
  roles: Role[];
  ip?: string | null;
}

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) throw unauthorized();
  return actor;
}

export function requireRole(actor: Actor | null | undefined, role: Role): Actor {
  const a = requireActor(actor);
  if (!a.roles.includes(role)) throw forbidden();
  return a;
}

/** 감사 로그 기록 (관리자·점주의 주요 작업) */
export async function audit(
  q: Queryable,
  actor: Actor | null,
  action: string,
  targetType: string,
  targetId: string | null,
  detail?: Record<string, unknown>,
) {
  await q.query(
    `insert into audit_logs (actor_user_id, actor_role, action, target_type, target_id, detail, ip)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor?.userId ?? null,
      actor ? (actor.roles.includes('admin') ? 'admin' : actor.roles.includes('owner') ? 'owner' : 'consumer') : 'system',
      action,
      targetType,
      targetId,
      detail ? JSON.stringify(detail) : null,
      actor?.ip ?? null,
    ],
  );
}
