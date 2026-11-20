import type { Role } from '@cheong/core';
import { audit, requireActor, type Actor, type Ctx } from '../context';
import { conflict, forbidden, unauthorized, validation } from '../errors';
import { hashPassword, newSessionToken, sha256, validatePassword, verifyPassword } from '../security';
import { releaseSeatsAndSetStatus } from './reservations';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupInput {
  email: string;
  password: string;
  nickname: string;
  role: 'consumer' | 'owner';
  agreeTerms: boolean;
  agreePrivacy: boolean;
  agreeLocation?: boolean;
  agreeMarketing?: boolean;
}

export async function signup(ctx: Ctx, input: SignupInput) {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 120) throw validation('이메일 형식이 올바르지 않아요.');
  const pwErr = validatePassword(String(input.password ?? ''));
  if (pwErr) throw validation(pwErr);
  const nickname = String(input.nickname ?? '').trim();
  if (nickname.length < 1 || nickname.length > 20) throw validation('닉네임은 1~20자로 입력해 주세요.');
  if (input.role !== 'consumer' && input.role !== 'owner') throw validation('가입 유형이 올바르지 않아요.');
  if (!input.agreeTerms || !input.agreePrivacy) throw validation('이용약관과 개인정보 수집·이용에 동의해 주세요.');

  const hash = await hashPassword(input.password);
  const now = ctx.now();
  const userId = await ctx.db.tx(async (q) => {
    const exists = await q.query(`select 1 from users where lower(email) = $1 and status <> 'WITHDRAWN'`, [email]);
    if (exists.length) throw conflict('이미 가입된 이메일이에요.');
    const [u] = await q.query<{ id: string }>(
      `insert into users (email, password_hash) values ($1, $2) returning id`,
      [email, hash],
    );
    const id = u!.id;
    await q.query(`insert into user_roles (user_id, role) values ($1, $2)`, [id, input.role]);
    await q.query(
      `insert into user_profiles (user_id, nickname, terms_agreed_at, privacy_agreed_at, location_consent_at, marketing_consent_at)
       values ($1, $2, $3, $3, $4, $5)`,
      [id, nickname, now, input.agreeLocation ? now : null, input.agreeMarketing ? now : null],
    );
    await q.query(`insert into notification_preferences (user_id, marketing) values ($1, $2)`, [id, !!input.agreeMarketing]);
    return id;
  });
  return createSession(ctx, userId);
}

export async function login(ctx: Ctx, email: string, password: string) {
  const rows = await ctx.db.query<{ id: string; password_hash: string; status: string }>(
    `select id, password_hash, status from users where lower(email) = $1 and status <> 'WITHDRAWN'`,
    [String(email ?? '').trim().toLowerCase()],
  );
  const u = rows[0];
  // 존재 여부와 무관하게 해시 비교 시간을 비슷하게 맞춘다
  const ok = u ? await verifyPassword(String(password ?? ''), u.password_hash) : (await hashPassword('dummy-password1'), false);
  if (!u || !ok) throw unauthorized('이메일 또는 비밀번호가 맞지 않아요.');
  if (u.status !== 'ACTIVE') throw forbidden('이용이 제한된 계정이에요. 고객센터에 문의해 주세요.');
  return createSession(ctx, u.id);
}

async function createSession(ctx: Ctx, userId: string) {
  const { token, hash } = newSessionToken();
  const expires = new Date(ctx.now().getTime() + ctx.config.sessionTtlDays * 86400_000);
  await ctx.db.query(`insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)`, [userId, hash, expires]);
  return { token, expiresAt: expires, user: await getMe(ctx, userId) };
}

export async function authenticate(ctx: Ctx, token: string | null | undefined, ip?: string | null): Promise<Actor | null> {
  if (!token || token.length > 200) return null;
  const rows = await ctx.db.query<{ user_id: string; roles: Role[] | null }>(
    `select s.user_id, array(select role from user_roles r where r.user_id = s.user_id) as roles
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > $2 and u.status = 'ACTIVE'`,
    [sha256(token), ctx.now()],
  );
  const r = rows[0];
  if (!r) return null;
  return { userId: r.user_id, roles: (r.roles ?? []) as Role[], ip: ip ?? null };
}

export async function logout(ctx: Ctx, token: string) {
  await ctx.db.query(`update sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null`, [sha256(token), ctx.now()]);
}

export async function getMe(ctx: Ctx, userId: string) {
  const [r] = await ctx.db.query<{
    id: string;
    email: string;
    nickname: string;
    phone: string | null;
    roles: Role[];
    location_consent_at: Date | null;
    home_region_id: string | null;
  }>(
    `select u.id, u.email, p.nickname, p.phone, p.location_consent_at, p.home_region_id,
            array(select role from user_roles r where r.user_id = u.id) as roles
       from users u join user_profiles p on p.user_id = u.id where u.id = $1`,
    [userId],
  );
  if (!r) throw unauthorized();
  return {
    id: r.id,
    email: r.email,
    nickname: r.nickname,
    phone: r.phone,
    roles: r.roles,
    locationConsent: !!r.location_consent_at,
    homeRegionId: r.home_region_id,
  };
}

export async function updateProfile(
  ctx: Ctx,
  actor: Actor | null,
  input: { nickname?: string; phone?: string | null; homeRegionId?: string | null; locationConsent?: boolean },
) {
  const a = requireActor(actor);
  if (input.nickname !== undefined) {
    const n = input.nickname.trim();
    if (n.length < 1 || n.length > 20) throw validation('닉네임은 1~20자로 입력해 주세요.');
    await ctx.db.query(`update user_profiles set nickname = $2, updated_at = now() where user_id = $1`, [a.userId, n]);
  }
  if (input.phone !== undefined) {
    const p = input.phone ? input.phone.replace(/[^\d-]/g, '') : null;
    if (p && !/^01\d-?\d{3,4}-?\d{4}$/.test(p)) throw validation('휴대폰 번호 형식이 올바르지 않아요.');
    await ctx.db.query(`update user_profiles set phone = $2, updated_at = now() where user_id = $1`, [a.userId, p]);
  }
  if (input.homeRegionId !== undefined) {
    if (input.homeRegionId) {
      const r = await ctx.db.query(`select 1 from weather_regions where id = $1`, [input.homeRegionId]);
      if (!r.length) throw validation('지역을 찾을 수 없어요.');
    }
    await ctx.db.query(`update user_profiles set home_region_id = $2, updated_at = now() where user_id = $1`, [
      a.userId,
      input.homeRegionId,
    ]);
  }
  if (input.locationConsent !== undefined) {
    await ctx.db.query(`update user_profiles set location_consent_at = $2, updated_at = now() where user_id = $1`, [
      a.userId,
      input.locationConsent ? ctx.now() : null,
    ]);
  }
  return getMe(ctx, a.userId);
}

/**
 * 회원 탈퇴: 개인정보를 즉시 파기(가명화)하고, 예정된 예약은 취소한다.
 * 예약·방문 기록은 매장 정산·분쟁 대응을 위해 개인 식별 정보 없이 보존한다.
 * (보존 기간은 docs/법률-검토-항목.md 참고 — 법률 검토 전 확정 아님)
 */
export async function withdraw(ctx: Ctx, actor: Actor | null, password: string) {
  const a = requireActor(actor);
  if (a.roles.includes('owner') || a.roles.includes('admin')) {
    throw forbidden('점주·관리자 계정은 운영팀을 통해 탈퇴할 수 있어요. (매장 데이터 이관 필요)');
  }
  const [u] = await ctx.db.query<{ password_hash: string }>(`select password_hash from users where id = $1`, [a.userId]);
  if (!u || !(await verifyPassword(password ?? '', u.password_hash))) throw unauthorized('비밀번호가 맞지 않아요.');
  const now = ctx.now();
  await ctx.db.tx(async (q) => {
    const upcoming = await q.query<{ id: string }>(
      `select id from reservations where user_id = $1 and status in ('PENDING', 'CONFIRMED') for update`,
      [a.userId],
    );
    for (const r of upcoming) {
      await releaseSeatsAndSetStatus(q, r.id, 'CANCELLED_BY_USER', a, '회원 탈퇴', now);
    }
    await q.query(
      `update users set status = 'WITHDRAWN', email = $2, password_hash = '', withdrawn_at = $3, updated_at = $3 where id = $1`,
      [a.userId, `withdrawn+${a.userId}@deleted.invalid`, now],
    );
    await q.query(
      `update user_profiles set nickname = '탈퇴회원', phone = null, home_region_id = null,
              location_consent_at = null, marketing_consent_at = null, updated_at = $2 where user_id = $1`,
      [a.userId, now],
    );
    await q.query(`delete from favorites where user_id = $1`, [a.userId]);
    await q.query(`delete from notifications where user_id = $1`, [a.userId]);
    await q.query(`update notification_preferences set push_token = null, marketing = false where user_id = $1`, [a.userId]);
    await q.query(`update sessions set revoked_at = $2 where user_id = $1 and revoked_at is null`, [a.userId, now]);
    await audit(q, a, 'USER_WITHDRAW', 'user', a.userId);
  });
}
