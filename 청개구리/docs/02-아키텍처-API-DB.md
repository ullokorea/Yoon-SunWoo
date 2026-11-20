# 아키텍처 · API · 데이터베이스

## 1. 시스템 구조

```
 [소비자 앱 Expo]  ──Bearer 토큰──┐
                                  ▼
 [점주/관리자 웹 Next.js] ─쿠키─▶ [/api/v1/* Route Handler] ──▶ packages/server (서비스·권한 검증)
                                                                 │        │
                                                     packages/core │        ├─▶ WeatherAdapter (KMA | Mock)
                                         (순수 규칙: 날씨·할인·예약) │        └─▶ PushSender (Expo | Mock)
                                                                 ▼
                                               PostgreSQL (로컬 PGlite / 운영 Supabase)
```

- **규칙은 `packages/core`** 에 순수 함수로 둔다 (DB·네트워크 없음 → 빠른 단위 테스트, 앱에서도 재사용).
- **모든 쓰기·권한 판단은 서버**에서 한다. 화면의 역할 가드는 편의일 뿐, API 가 매 요청 역할·소유권을 다시 확인한다.
- **가격은 서버가 계산**한다. 클라이언트는 메뉴 ID·수량만 보내고, 가격 필드를 보내도 버린다.
- **예약 트랜잭션**: 캠페인·슬롯 행 `FOR UPDATE` → 판정 → 중복·선착순 확인 → 가격 계산 → `UPDATE … SET booked = booked + n WHERE booked + n <= capacity`(원자적 차감) → 예약 + 항목 스냅샷 + 이력 + 알림.
- **주기 작업** `runTick`: 오래된 지역 날씨 갱신(10분), 승인 지연 만료(30분), 방문 1시간 전 알림, 알림 발송. 운영은 외부 스케줄러가 `POST /api/v1/jobs/tick` 호출, 개발은 요청 시 1분마다 자동.

## 2. 날씨 판정 (packages/core/src/weather.ts)

지역 = 기상청 5km 격자(nx, ny). 매장 등록 시 좌표로 격자를 계산해 지역에 연결한다.

| 축 | 상태 | 규칙 |
|---|---|---|
| 강수 | CLEAR / FORECAST / RAINING | PTY∈{1,2,4,5,6} 또는 RN1≥0.1mm → 즉시 RAINING. 해제는 **진입 후 60분 경과 + 연속 2회 무강수** (깜빡임 방지). 6시간 내 강수 예보 → FORECAST |
| 안전 | NORMAL / TYPHOON_WATCH / DANGER / RECOVERY / UNKNOWN | 태풍·강풍·호우·폭풍해일·홍수 **주의보·경보 → 즉시 DANGER**. 해제 확인 후 **6시간 유예** → RECOVERY (운영자가 현장 안전 확인 시 조기 전환 가능, 감사 로그). RECOVERY 72시간 후 NORMAL. 태풍 진로/예비특보 → TYPHOON_WATCH. 데이터 30분 이상 미수신 → UNKNOWN (DANGER 는 유지) |

화면 모드 = 안전 축 우선, 그다음 강수 축. 모든 전환은 `region_weather_history` 에 근거와 함께 기록.

## 3. 할인 판정 (packages/core/src/discount.ts `checkBookingEligibility`)

순서: 안전(DANGER·UNKNOWN 차단) → 매장 상태·영업 중단 → 슬롯(마감·10분 전·영업시간) → 인원·정원 → 캠페인(승인·일시정지·기간·적용 시간대) → 유형별 조건

| 유형 | 할인율 | 예약 가능 조건 |
|---|---|---|
| RAIN 우천 | 10~30% | RAINING, **오늘 방문**, (태풍 접근 중이면 안전 시간대만) |
| TYPHOON_PRE 태풍 사전 | 10~50% | TYPHOON_WATCH, 슬롯 **종료 시각 ≤ 영향 예상 − 6시간**. 영향 시각 모르면 차단 |
| TYPHOON_RECOVERY 회복 | 10~50% | RECOVERY + **점주 영업 재개 확인** 후 / 또는 WATCH 단계에서 **영향 종료 + 24시간 이후** 슬롯 사전 예약 |

태풍 특가는 관리자 검수 후 노출. 할인율 상한은 DB CHECK 제약으로 이중 방어.

## 4. API (`/api/v1`)

응답: `{ "data": … }` 또는 `{ "error": { "code", "message", "detail" } }`.
인증: 웹은 httpOnly 쿠키 `cg_session`(SameSite=Lax, 상태 변경 요청은 Origin 검사), 앱은 `Authorization: Bearer <token>`.
오류 코드: `VALIDATION 422`, `UNAUTHORIZED 401`, `FORBIDDEN 403`, `NOT_FOUND 404`, `CONFLICT 409`, `BOOKING_BLOCKED 409 (detail.code)`, `RATE_LIMITED 429`.

### 공통·인증
| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `health` | – | 환경·DB·날씨/푸시 모드(Mock 여부) |
| POST | `auth/signup` | – | `{email,password,nickname,role:'consumer'|'owner',agreeTerms,agreePrivacy,agreeLocation?,agreeMarketing?}` (관리자 가입 불가) |
| POST | `auth/login` · `auth/logout` | – | 로그인 IP당 10분 20회, 이메일당 8회 제한 |
| GET/PATCH | `me` | 로그인 | 프로필 (닉네임·휴대폰·기본 지역·위치 동의) |
| POST | `me/withdraw` | 소비자 | `{password}` 탈퇴 (개인정보 가명화, 예정 예약 취소) |

### 소비자
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `regions`, `regions/locate?lat&lng` | 지역 목록 / 좌표의 지역(30km 이내) + 모드·문구 |
| GET | `stores?lat&lng&sort=distance|discount&category&priceLevel&availableOnly` | 승인 매장 + 지금 할인율·다음 예약 가능 슬롯·거리 |
| GET | `stores/:id` | 상세 + 캠페인 + 4일간 슬롯별 적용 할인/차단 사유 |
| POST | `stores/:id/favorite` | `{on, notify}` |
| GET | `favorites` | 즐겨찾기 |
| POST | `reservations/quote` | 견적 (쓰기 없음) |
| POST | `reservations` | `{storeId,slotId,campaignId,partySize,items:[{menuId,quantity}]}` → 예약 (사용자당 시간 20회) |
| GET | `reservations`, `reservations/:id` | 내 예약 / 상세(본인 확정 예약에만 `qrToken`) |
| POST | `reservations/:id/cancel` | 취소 (위험 지역이면 `CANCELLED_SAFETY`) |
| GET/POST | `notifications`, `notifications/read` | 인앱 알림 |
| GET/PATCH | `notification-preferences` | 알림 설정, `pushToken` |
| POST | `reports` | 신고·문의 |

### 점주 (`owner/stores/:id/…`, 소유 매장만)
`GET owner/stores` · `POST owner/stores`(사업자번호 체크섬) · `GET/PATCH owner/stores/:id` · `POST …/pause {paused}` · `POST …/reopen`(RECOVERY 단계) · `POST/PATCH/DELETE …/menus[/:menuId]` · `GET …/slots` · `POST …/slots/generate {dates,times,capacity,durationMinutes}` · `POST …/slots/:slotId/close {closed}` · `GET/POST …/campaigns` · `PATCH …/campaigns/:cid` · `POST …/campaigns/:cid/pause` · `GET …/reservations?date&status` · `GET …/reservations/:rid` · `POST …/reservations/:rid/action {action: APPROVE|REJECT|CANCEL_BY_STORE|CANCEL_SAFETY|NO_SHOW, reason}` · `POST …/verify {token}|{code}` · `GET …/dashboard` · `GET …/stats?days`

### 관리자 (`admin/…`)
`overview` · `stores?status` · `stores/:id/review {decision: APPROVE|REJECT|SUSPEND|RESTORE, note}` · `campaigns?status` · `campaigns/:id/review` · `reservations?status` · `users` · `users/:id/status` · `anomalies` · `audit-logs` · `reports` · `reports/:id` · `regions/:id`(이력·특보) · `regions/:id/mock {scenario}`(Mock 모드 전용) · `regions/:id/safety {target: DANGER|RECOVERY, reason}` · `regions/typhoon {regionIds, outlook}` · `weather/refresh`

### 작업
`POST jobs/tick` — `Authorization: Bearer $CRON_SECRET`

## 5. 데이터베이스

마이그레이션: `packages/server/migrations/0001_init.sql` (로컬·운영 공용), Supabase 전용 RLS: `packages/server/migrations-supabase/9000_rls.sql`.
모든 PK 는 `uuid default gen_random_uuid()`, 시간은 `timestamptz`, 금액은 원 단위 `integer`.

| 테이블 | 용도 | 주요 제약·인덱스 |
|---|---|---|
| users | 계정 | `lower(email)` 부분 유니크(탈퇴 제외), status ACTIVE/SUSPENDED/WITHDRAWN |
| user_roles | 역할 | PK(user_id, role), role ∈ consumer/owner/admin |
| sessions | 세션 | token **sha256 해시**만 저장, 만료·폐기 |
| user_profiles | 프로필·동의 시각 | 약관/개인정보 동의 시각 필수, 위치·마케팅 동의 시각 |
| weather_regions | 지역 + 현재 판정 상태 | UNIQUE(nx, ny), 상태 CHECK, manual_typhoon, mock_scenario |
| weather_observations | 관측 원본 | (region_id, observed_at desc) |
| weather_alerts | 특보 | 발효/해제 시각 |
| region_weather_history | 상태 전환 이력 (요구사항의 store_weather_states 역할) | (region_id, created_at desc) |
| stores | 매장 | status, business_hours jsonb, operation_paused, reopen_confirmed_at, is_sample |
| store_owners | 점주-매장 | PK(store_id, user_id) |
| store_business_verifications | 사업자 정보 | SUBMITTED/APPROVED/REJECTED |
| store_images | 사진 URL | |
| menus | 메뉴 | price 1~1천만, is_set, is_available |
| discount_campaigns | 할인 | **rate CHECK(우천 10~30, 태풍 10~50)**, valid_until > valid_from, 검수 상태 |
| discount_rules | 특정 메뉴·세트 대상 | PK(campaign_id, menu_id) |
| campaign_events | 할인 변경 이력 | |
| reservation_slots | 예약 가능 시간 | **CHECK(0 ≤ booked ≤ capacity)**, UNIQUE(store_id, start_at) |
| reservations | 예약 + **할인 조건 스냅샷** | **부분 UNIQUE(user_id, slot_id) WHERE 활성**, CHECK(total = subtotal − discount), 코드 UNIQUE |
| reservation_items | 메뉴명·단가·할인율 스냅샷 | |
| reservation_status_history | 상태 이력 | actor_role |
| qr_verifications | 모든 확인 시도 | **부분 UNIQUE(reservation_id) WHERE result='SUCCESS'** (재사용 방지) |
| favorites, notification_preferences, notifications | 즐겨찾기·알림 | 알림 (user_id, type, created_at) 빈도 제한용 인덱스 |
| reports | 신고·문의 | |
| audit_logs | 관리자·점주 주요 작업 | (created_at desc), (target_type, target_id) |

### 접근 권한
- 애플리케이션: API 서버만 DB 에 접속하며 서비스 함수가 역할·소유권 검증 (`requireRole`, `assertOwner`, `canView`).
- Supabase: `9000_rls.sql` 이 모든 테이블에 RLS 를 켜고 anon/authenticated 권한을 회수 → 클라이언트 직접 접근 **기본 거부**.
- 관리자 화면의 개인정보는 마스킹(이메일·이름·전화). 점주에게는 방문 확인에 필요한 닉네임과 마스킹된 전화번호만.
