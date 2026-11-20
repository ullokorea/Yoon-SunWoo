// 로컬 개발 DB 초기화: PGlite 데이터 삭제 → 마이그레이션 → 샘플 데이터
// 사용: npm run db:reset
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createContext, openDb, repoRoot, seed, SEED_ACCOUNTS_INFO } from '../cli-helpers';

async function main() {
  if (process.env.DATABASE_URL) {
    console.error('DATABASE_URL 이 설정되어 있어 초기화를 중단합니다. (원격 DB 보호)');
    process.exit(1);
  }
  const dir = process.env.PGLITE_DATA_DIR ? resolve(process.env.PGLITE_DATA_DIR) : join(repoRoot(), '.data', 'pglite');
  rmSync(dir, { recursive: true, force: true });
  const db = await openDb();
  const ctx = await createContext({ db });
  const r = await seed(ctx, { force: true });
  await db.close();
  console.log(`✔ 로컬 DB 초기화 완료: ${dir}`);
  console.log(r);
  console.log(SEED_ACCOUNTS_INFO);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
