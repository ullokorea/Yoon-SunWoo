-- Supabase 전용: Row Level Security (로컬 PGlite 에는 적용하지 않음)
--
-- 청개구리는 모든 읽기·쓰기를 API 서버(Next.js Route Handlers)를 거쳐 처리하고,
-- API 서버는 서비스 역할(service_role / DB owner)로 접속해 서버 코드에서 역할·소유권을 검증한다.
--
-- 따라서 Supabase 의 anon / authenticated 역할(브라우저·앱에서 PostgREST 로 직접 접근)은
-- 어떤 테이블에도 접근할 수 없도록 "기본 거부(deny by default)" 로 잠근다.
-- 정책(policy)을 하나도 만들지 않은 채 RLS 를 켜면 해당 역할의 모든 행 접근이 거부된다.
-- (테이블 소유자로 접속하는 API 서버는 RLS 를 우회한다 — FORCE 는 쓰지 않는다.)
--
-- 추후 클라이언트에서 Supabase 를 직접 조회해야 하는 기능이 생기면,
-- 해당 테이블에만 최소 범위 정책을 추가한다. 예시는 파일 하단 주석 참고.

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'user_roles', 'sessions', 'user_profiles',
    'weather_regions', 'weather_observations', 'weather_alerts', 'region_weather_history',
    'stores', 'store_owners', 'store_business_verifications', 'store_images', 'menus',
    'discount_campaigns', 'discount_rules', 'campaign_events',
    'reservation_slots', 'reservations', 'reservation_items', 'reservation_status_history', 'qr_verifications',
    'favorites', 'notification_preferences', 'notifications',
    'reports', 'audit_logs', 'schema_migrations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 예시) 승인된 매장 목록을 클라이언트에서 직접 읽어야 할 때:
-- grant select on public.stores to anon, authenticated;
-- create policy stores_public_read on public.stores for select to anon, authenticated
--   using (status = 'APPROVED');
