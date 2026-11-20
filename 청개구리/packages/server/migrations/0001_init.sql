-- 청개구리 초기 스키마 (PostgreSQL 15+ / Supabase / PGlite 공용)
-- 시간은 모두 timestamptz(UTC 저장), 화면 표시는 KST 변환.
-- 금액은 원 단위 정수(integer).

-- ============ 사용자 ============
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'WITHDRAWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create unique index users_email_uq on users (lower(email)) where status <> 'WITHDRAWN';

create table user_roles (
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('consumer', 'owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id);

-- ============ 기상 지역 ============
create table weather_regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nx integer not null,
  ny integer not null,
  center_lat double precision not null,
  center_lng double precision not null,
  -- 기상특보 구역 코드 (기상청 특보구역). 미설정이면 실제 특보 연동 시 판정 불가 → UNKNOWN
  warning_area_code text,
  rain_state text not null default 'CLEAR' check (rain_state in ('CLEAR', 'FORECAST', 'RAINING')),
  rain_since timestamptz,
  dry_observation_count integer not null default 0,
  safety_state text not null default 'UNKNOWN'
    check (safety_state in ('NORMAL', 'TYPHOON_WATCH', 'DANGER', 'RECOVERY', 'UNKNOWN')),
  safety_since timestamptz not null default now(),
  danger_cleared_at timestamptz,
  typhoon jsonb,
  -- 운영자가 기상청 태풍 발표를 보고 입력한 영향 예상 시각 (자동 판정이 어려운 항목)
  manual_typhoon jsonb,
  last_snapshot_at timestamptz,
  last_source text check (last_source in ('KMA', 'MOCK')),
  last_fetch_at timestamptz,
  last_fetch_error text,
  -- 개발 모드 Mock 시나리오 (운영에서는 사용 안 함)
  mock_scenario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nx, ny)
);

create table weather_observations (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references weather_regions (id) on delete cascade,
  observed_at timestamptz not null,
  source text not null check (source in ('KMA', 'MOCK')),
  precipitation_type integer not null,
  rainfall_1h double precision not null,
  rain_prob_6h integer,
  rain_expected_6h boolean not null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index weather_obs_region_idx on weather_observations (region_id, observed_at desc);

create table weather_alerts (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references weather_regions (id) on delete cascade,
  kind text not null check (kind in ('TYPHOON', 'WIND', 'HEAVY_RAIN', 'STORM_SURGE', 'FLOOD', 'OTHER')),
  level text not null check (level in ('PRELIMINARY', 'ADVISORY', 'WARNING')),
  title text not null,
  source text not null check (source in ('KMA', 'MOCK')),
  issued_at timestamptz not null,
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);
create index weather_alerts_region_idx on weather_alerts (region_id, issued_at desc);

-- 지역 날씨 상태 전환 이력 (요구사항의 store_weather_states 역할: 매장은 지역 상태를 따른다)
create table region_weather_history (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references weather_regions (id) on delete cascade,
  prev_rain text not null,
  next_rain text not null,
  prev_safety text not null,
  next_safety text not null,
  reason text not null,
  source text,
  created_at timestamptz not null default now()
);
create index region_weather_history_idx on region_weather_history (region_id, created_at desc);

-- ============ 프로필 ============
create table user_profiles (
  user_id uuid primary key references users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  phone text,
  location_consent_at timestamptz,
  marketing_consent_at timestamptz,
  terms_agreed_at timestamptz not null,
  privacy_agreed_at timestamptz not null,
  home_region_id uuid references weather_regions (id),
  updated_at timestamptz not null default now()
);

-- ============ 매장 ============
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  category text not null check (category in ('KOREAN', 'CAFE', 'WESTERN', 'JAPANESE', 'CHINESE', 'BAR', 'BAKERY', 'ETC')),
  description text not null default '',
  address text not null,
  lat double precision not null,
  lng double precision not null,
  phone text,
  region_id uuid not null references weather_regions (id),
  price_level smallint not null default 2 check (price_level between 1 and 3),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  status_note text,
  business_hours jsonb not null,
  operation_paused boolean not null default false,
  reopen_confirmed_at timestamptz,
  auto_approve boolean not null default true,
  is_sample boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stores_region_idx on stores (region_id);
create index stores_status_idx on stores (status);

create table store_owners (
  store_id uuid not null references stores (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index store_owners_user_idx on store_owners (user_id);

create table store_business_verifications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  business_number text not null,
  representative_name text not null,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references users (id),
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index sbv_store_idx on store_business_verifications (store_id);

create table store_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index store_images_store_idx on store_images (store_id, sort_order);

create table menus (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  description text not null default '',
  price integer not null check (price > 0 and price <= 10000000),
  is_set boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menus_store_idx on menus (store_id, sort_order);

-- ============ 할인 ============
create table discount_campaigns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  kind text not null check (kind in ('RAIN', 'TYPHOON_PRE', 'TYPHOON_RECOVERY')),
  title text not null,
  rate integer not null,
  scope text not null default 'ALL' check (scope in ('ALL', 'MENUS')),
  daily_start_time text not null,
  daily_end_time text not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  max_discount_amount integer check (max_discount_amount > 0),
  min_order_amount integer not null default 0 check (min_order_amount >= 0),
  max_party_size integer not null default 4 check (max_party_size between 1 and 20),
  daily_limit integer check (daily_limit > 0),
  auto_activate boolean not null default true,
  paused boolean not null default false,
  status text not null check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  review_note text,
  reviewed_by uuid references users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- DB 차원 할인율 상한 (애플리케이션 검증과 이중 방어)
  constraint discount_rate_bounds check (
    (kind = 'RAIN' and rate between 10 and 30) or (kind <> 'RAIN' and rate between 10 and 50)
  ),
  constraint discount_valid_range check (valid_until > valid_from)
);
create index discount_campaigns_store_idx on discount_campaigns (store_id, kind);

-- 요구사항의 discount_rules: 특정 메뉴·세트 할인 대상
create table discount_rules (
  campaign_id uuid not null references discount_campaigns (id) on delete cascade,
  menu_id uuid not null references menus (id) on delete cascade,
  primary key (campaign_id, menu_id)
);

create table campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references discount_campaigns (id) on delete cascade,
  type text not null,
  actor_user_id uuid references users (id),
  payload jsonb,
  created_at timestamptz not null default now()
);
create index campaign_events_idx on campaign_events (campaign_id, created_at desc);

-- ============ 예약 ============
create table reservation_slots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  start_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 240),
  capacity integer not null check (capacity between 1 and 200),
  booked integer not null default 0,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slot_booked_bounds check (booked >= 0 and booked <= capacity),
  unique (store_id, start_at)
);
create index reservation_slots_store_idx on reservation_slots (store_id, start_at);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references users (id),
  store_id uuid not null references stores (id),
  slot_id uuid not null references reservation_slots (id),
  campaign_id uuid not null references discount_campaigns (id),
  party_size integer not null check (party_size between 1 and 20),
  status text not null check (status in (
    'PENDING', 'CONFIRMED', 'VISITED', 'REJECTED', 'EXPIRED',
    'CANCELLED_BY_USER', 'CANCELLED_BY_STORE', 'CANCELLED_SAFETY', 'NO_SHOW')),
  -- 확정 시점 할인 조건 스냅샷 (이후 캠페인 변경·날씨 변화와 무관하게 보존)
  campaign_kind text not null,
  discount_rate integer not null,
  subtotal integer not null check (subtotal >= 0),
  discount_amount integer not null check (discount_amount >= 0),
  total_amount integer not null check (total_amount >= 0),
  discount_capped boolean not null default false,
  campaign_snapshot jsonb not null,
  weather_mode_at_booking text not null,
  qr_nonce text not null,
  status_reason text,
  slot_start_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  visited_at timestamptz,
  cancelled_at timestamptz,
  constraint reservation_amounts check (total_amount = subtotal - discount_amount)
);
-- 같은 사용자가 같은 슬롯을 중복 예약하지 못하게 (활성 상태만)
create unique index reservations_user_slot_active_uq on reservations (user_id, slot_id)
  where status in ('PENDING', 'CONFIRMED');
create index reservations_user_idx on reservations (user_id, created_at desc);
create index reservations_store_idx on reservations (store_id, slot_start_at);
create index reservations_campaign_idx on reservations (campaign_id, slot_start_at);

create table reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations (id) on delete cascade,
  menu_id uuid references menus (id) on delete set null,
  menu_name text not null,
  unit_price integer not null,
  quantity integer not null check (quantity > 0),
  discount_rate integer not null,
  line_subtotal integer not null,
  line_discount integer not null
);
create index reservation_items_res_idx on reservation_items (reservation_id);

create table reservation_status_history (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_user_id uuid references users (id),
  actor_role text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index rsh_res_idx on reservation_status_history (reservation_id, created_at);

create table qr_verifications (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references reservations (id) on delete cascade,
  store_id uuid references stores (id),
  scanned_by uuid references users (id),
  result text not null check (result in ('SUCCESS', 'REUSED', 'INVALID', 'WRONG_STORE', 'NOT_CONFIRMED', 'OUT_OF_WINDOW')),
  created_at timestamptz not null default now()
);
-- 동일 QR 재사용 방지: 성공 확인은 예약당 1회만
create unique index qr_success_once_uq on qr_verifications (reservation_id) where result = 'SUCCESS';

-- ============ 즐겨찾기·알림 ============
create table favorites (
  user_id uuid not null references users (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index favorites_store_idx on favorites (store_id);

create table notification_preferences (
  user_id uuid primary key references users (id) on delete cascade,
  rain_alerts boolean not null default true,
  favorite_alerts boolean not null default true,
  typhoon_alerts boolean not null default true,
  reservation_alerts boolean not null default true,
  marketing boolean not null default false,
  push_token text,
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb,
  dedupe_key text,
  channel text not null default 'PUSH' check (channel in ('PUSH', 'IN_APP')),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'SENT_MOCK', 'SKIPPED', 'FAILED')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_throttle_idx on notifications (user_id, type, created_at desc);
create index notifications_queue_idx on notifications (status) where status = 'QUEUED';

-- ============ 운영 ============
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references users (id) on delete set null,
  store_id uuid references stores (id) on delete set null,
  reservation_id uuid references reservations (id) on delete set null,
  type text not null check (type in ('STORE_ISSUE', 'DISCOUNT_MISMATCH', 'NO_SHOW_DISPUTE', 'INQUIRY', 'ETC')),
  content text not null check (char_length(content) between 1 and 2000),
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users (id) on delete set null,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_target_idx on audit_logs (target_type, target_id);
