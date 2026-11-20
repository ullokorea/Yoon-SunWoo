# 청개구리 프로젝트

날씨 기반 오프라인 할인·예약 플랫폼 MVP. 슬로건: "비가 오면, 혜택이 쏟아진다."

- 전체 요구사항(원본 프롬프트): [개발-프롬프트.md](개발-프롬프트.md) — 이 폴더에서 작업할 때는 항상 이 문서를 기준으로 삼는다.
- 현재 상태·실행 방법: [README.md](README.md), 결정 사항: [docs/01-요구사항-분석.md](docs/01-요구사항-분석.md), 최종 보고: [docs/06-최종-보고.md](docs/06-최종-보고.md)

## 핵심 원칙
- 기획서·목업에서 끝내지 말고 실제 동작하는 코드를 만든다.
- API 키·결제·외부 연동 상태를 허위로 표시하지 않는다. 키가 없으면 실제 Adapter와 Mock Adapter를 분리하고, Mock임을 화면에 명확히 표시한다.
- 예약 수량·할인 가격은 서버에서 검증하고, 확정 예약의 조건은 날씨가 바뀌어도 보존한다.
- 위험한 태풍 상황에는 신규 방문 예약을 막는다(불확실하면 보수적으로 제한).
- 소비자·점주·관리자 권한을 서버에서 분리한다.
- 모바일 UX 우선, Phase 1(MVP) 핵심 예약 흐름부터 완성한다.

## 개발 메모
- Node 는 `C:\Program Files\nodejs` 에 설치됨 (Git Bash 에서는 `export PATH="/c/Program Files/nodejs:$PATH"` 필요).
- 규칙 변경은 `packages/core` (순수 함수 + 테스트), DB 를 쓰는 로직은 `packages/server/src/services`, API 경로는 `apps/web/lib/router.ts` 한 곳.
- 스키마 변경은 `packages/server/migrations/` 에 새 번호 파일 추가 (기존 파일 수정 금지 — 운영 DB 에 이미 적용됨 가정).
- 변경 후 `npm test` (110개) 와 `npm run typecheck` 를 돌린다.
- Next.js 16·Expo SDK 58 은 학습 데이터와 다를 수 있다 — `apps/web/AGENTS.md`, `apps/mobile/AGENTS.md` 참고.
