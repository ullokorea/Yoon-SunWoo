// 비밀번호 해시, 세션 토큰, QR 토큰 서명, 요청 횟수 제한

import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8 || pw.length > 72) return '비밀번호는 8~72자로 입력해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호는 영문과 숫자를 함께 포함해야 해요.';
  return null;
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

export function randomNonce(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomCodeBytes(): Uint8Array {
  return randomBytes(6);
}

// ---------- QR 토큰 ----------
// 형식: CGQR1.<reservationId>.<nonce>.<sig>
// sig = HMAC-SHA256(QR_SECRET, "<reservationId>.<nonce>") base64url
// 서버 비밀키 없이는 위조할 수 없고, nonce 는 예약마다 무작위.

const QR_PREFIX = 'CGQR1';

export function signQrToken(secret: string, reservationId: string, nonce: string): string {
  const sig = createHmac('sha256', secret).update(`${reservationId}.${nonce}`).digest('base64url');
  return `${QR_PREFIX}.${reservationId}.${nonce}.${sig}`;
}

export function parseQrToken(secret: string, token: string): { reservationId: string; nonce: string } | null {
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== QR_PREFIX) return null;
  const [, reservationId, nonce, sig] = parts as [string, string, string, string];
  if (!/^[0-9a-f-]{36}$/i.test(reservationId)) return null;
  const expected = createHmac('sha256', secret).update(`${reservationId}.${nonce}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { reservationId, nonce };
}

// ---------- 요청 횟수 제한 (인메모리 고정 윈도) ----------
// 단일 인스턴스용. 다중 인스턴스 운영 시 Redis(Upstash 등) 기반으로 교체해야 한다.

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function resetRateLimits() {
  buckets.clear();
}

/** 개인정보 마스킹 (관리자 화면용) */
export function maskEmail(email: string): string {
  const [id, domain] = email.split('@');
  if (!id || !domain) return '***';
  return `${id.slice(0, 2)}${'*'.repeat(Math.max(1, id.length - 2))}@${domain}`;
}

export function maskName(name: string): string {
  if (name.length <= 1) return '*';
  return name[0] + '*'.repeat(name.length - 1);
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length < 8) return '***';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}
