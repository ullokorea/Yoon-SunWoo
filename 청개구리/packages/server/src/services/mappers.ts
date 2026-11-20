import type { BusinessHours, Campaign, Menu, Slot, StoreForBooking } from '@cheong/core';

export interface StoreRow {
  id: string;
  name: string;
  category: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  region_id: string;
  price_level: number;
  status: StoreForBooking['status'];
  status_note: string | null;
  business_hours: BusinessHours;
  operation_paused: boolean;
  reopen_confirmed_at: Date | null;
  auto_approve: boolean;
  is_sample: boolean;
  created_at: Date;
}

export interface CampaignRow {
  id: string;
  store_id: string;
  kind: Campaign['kind'];
  title: string;
  rate: number;
  scope: Campaign['scope'];
  daily_start_time: string;
  daily_end_time: string;
  valid_from: Date;
  valid_until: Date;
  max_discount_amount: number | null;
  min_order_amount: number;
  max_party_size: number;
  daily_limit: number | null;
  auto_activate: boolean;
  paused: boolean;
  status: Campaign['status'];
  review_note: string | null;
  menu_ids: string[] | null;
}

export interface MenuRow {
  id: string;
  store_id: string;
  name: string;
  description: string;
  price: number;
  is_set: boolean;
  is_available: boolean;
  sort_order: number;
}

export interface SlotRow {
  id: string;
  store_id: string;
  start_at: Date;
  duration_minutes: number;
  capacity: number;
  booked: number;
  closed: boolean;
}

export const toStoreForBooking = (r: StoreRow): StoreForBooking => ({
  id: r.id,
  status: r.status,
  operationPaused: r.operation_paused,
  reopenConfirmedAt: r.reopen_confirmed_at,
  businessHours: r.business_hours,
  autoApprove: r.auto_approve,
});

export const toCampaign = (r: CampaignRow): Campaign => ({
  id: r.id,
  storeId: r.store_id,
  kind: r.kind,
  title: r.title,
  rate: r.rate,
  scope: r.scope,
  menuIds: r.menu_ids ?? [],
  dailyStartTime: r.daily_start_time,
  dailyEndTime: r.daily_end_time,
  validFrom: r.valid_from,
  validUntil: r.valid_until,
  maxDiscountAmount: r.max_discount_amount,
  minOrderAmount: r.min_order_amount,
  maxPartySize: r.max_party_size,
  dailyLimit: r.daily_limit,
  autoActivate: r.auto_activate,
  paused: r.paused,
  status: r.status,
});

export const toMenu = (r: MenuRow): Menu => ({
  id: r.id,
  storeId: r.store_id,
  name: r.name,
  price: r.price,
  isSet: r.is_set,
  isAvailable: r.is_available,
});

export const toSlot = (r: SlotRow): Slot => ({
  id: r.id,
  storeId: r.store_id,
  startAt: r.start_at,
  durationMinutes: r.duration_minutes,
  capacity: r.capacity,
  booked: r.booked,
  closed: r.closed,
});

export const CAMPAIGN_SELECT = `
  select c.*, array(select menu_id from discount_rules d where d.campaign_id = c.id) as menu_ids
    from discount_campaigns c`;

export function menuView(m: MenuRow) {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    price: m.price,
    isSet: m.is_set,
    isAvailable: m.is_available,
    sortOrder: m.sort_order,
  };
}

export function campaignView(c: Campaign & { reviewNote?: string | null }) {
  return { ...c };
}

export const CATEGORY_LABEL: Record<string, string> = {
  KOREAN: '한식',
  CAFE: '카페',
  WESTERN: '양식',
  JAPANESE: '일식',
  CHINESE: '중식',
  BAR: '주점',
  BAKERY: '베이커리',
  ETC: '기타',
};
