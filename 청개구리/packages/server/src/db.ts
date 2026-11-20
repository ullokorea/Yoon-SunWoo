// DB 접근 추상화: 로컬은 PGlite(임베디드 Postgres), 운영은 postgres.js(Supabase 등)
// 같은 SQL 마이그레이션을 그대로 사용한다.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const wrap = (q: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = await q.query(sql, params);
      return r.rows as T[];
    },
  });
  const base = wrap(pg as never);
  return {
    kind: 'pglite',
    query: base.query,
    tx: (fn) => pg.transaction((t) => fn(wrap(t as never))),
    close: () => pg.close(),
  };
}

export async function createPostgresDb(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 10, prepare: false });
  const wrap = (s: { unsafe: (q: string, p?: never[]) => Promise<unknown> }): Queryable => ({
    async query<T>(q: string, params?: unknown[]) {
      return (await s.unsafe(q, (params ?? []) as never[])) as T[];
    },
  });
  const base = wrap(sql as never);
  return {
    kind: 'postgres',
    query: base.query,
    tx: (fn) => sql.begin((t) => fn(wrap(t as never))) as never,
    close: () => sql.end(),
  };
}

/**
 * 저장소 루트 찾기. Next.js 번들 안에서는 import.meta.url 이 번들 위치를 가리킬 수 있어
 * 현재 작업 디렉터리에서 위로 올라가며 packages/server/migrations 가 있는 곳을 찾는다.
 */
export function findRepoRoot(): string {
  if (process.env.CHEONG_ROOT) return resolve(/*turbopackIgnore: true*/ process.env.CHEONG_ROOT);
  const starts = [process.cwd()];
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* 번들 환경 */
  }
  for (const start of starts) {
    let dir = resolve(/*turbopackIgnore: true*/ start);
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(/*turbopackIgnore: true*/ dir, 'packages', 'server', 'migrations'))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error('청개구리 저장소 루트를 찾을 수 없습니다. CHEONG_ROOT 환경변수를 지정하세요.');
}

function migrationsDir(): string {
  return join(/*turbopackIgnore: true*/ findRepoRoot(), 'packages', 'server', 'migrations');
}

/** migrations/*.sql 을 이름순으로 한 번씩 적용 */
export async function migrate(db: Db, dir = migrationsDir()): Promise<string[]> {
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const done: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(/*turbopackIgnore: true*/ dir, f), 'utf8');
    await db.tx(async (q) => {
      await execMulti(q, sql);
      await q.query('insert into schema_migrations (name) values ($1)', [f]);
    });
    done.push(f);
  }
  return done;
}

/** 여러 문장으로 된 SQL 실행 (파라미터 없이) */
async function execMulti(q: Queryable, sql: string) {
  // PGlite 의 query 는 단일 문장만 받으므로 exec 가 있으면 사용
  const anyQ = q as unknown as { exec?: (s: string) => Promise<unknown> };
  if (typeof anyQ.exec === 'function') {
    await anyQ.exec(sql);
    return;
  }
  for (const stmt of splitSql(sql)) await q.query(stmt);
}

/** 단순 SQL 분할기: 세미콜론 기준, 주석·문자열·$$ 블록 고려 */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let inStr = false;
  let inDollar = false;
  while (i < sql.length) {
    const ch = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (!inStr && !inDollar && two === '--') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      cur += '\n';
      continue;
    }
    if (!inStr && two === '$$') {
      inDollar = !inDollar;
      cur += two;
      i += 2;
      continue;
    }
    if (!inDollar && ch === "'") inStr = !inStr;
    if (!inStr && !inDollar && ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
