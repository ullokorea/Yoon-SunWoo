// 할인 캠페인: 점주 등록·수정·일시정지, 관리자 검수

import { CAMPAIGN_KIND_LABEL, initialCampaignStatus, validateCampaignInput, type CampaignInput, type CampaignKind } from '@cheong/core';
import { audit, requireRole, type Actor, type Ctx } from '../context';
import type { Queryable } from '../db';
import { conflict, notFound, validation } from '../errors';
import { CAMPAIGN_SELECT, toCampaign, type CampaignRow } from './mappers';
import { enqueueNotification } from './notifications';
import { assertOwner } from './stores';

export interface CampaignBody {
  kind: CampaignKind;
  title: string;
  rate: number;
  scope: 'ALL' | 'MENUS';
  menuIds?: string[];
  dailyStartTime: string;
  dailyEndTime: string;
  validFrom: string;
  validUntil: string;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number;
  maxPartySize?: number;
  dailyLimit?: number | null;
  autoActivate?: boolean;
}

function toInput(b: CampaignBody): CampaignInput {
  return {
    kind: b.kind,
    title: String(b.title ?? ''),
    rate: Number(b.rate),
    scope: b.scope === 'MENUS' ? 'MENUS' : 'ALL',
    menuIds: Array.isArray(b.menuIds) ? b.menuIds.map(String) : [],
    dailyStartTime: String(b.dailyStartTime ?? ''),
    dailyEndTime: String(b.dailyEndTime ?? ''),
    validFrom: new Date(b.validFrom),
    validUntil: new Date(b.validUntil),
    maxDiscountAmount: b.maxDiscountAmount == null ? null : Number(b.maxDiscountAmount),
    minOrderAmount: Number(b.minOrderAmount ?? 0),
    maxPartySize: Number(b.maxPartySize ?? 4),
    dailyLimit: b.dailyLimit == null ? null : Number(b.dailyLimit),
  };
}

async function getCampaignRow(q: Queryable, id: string, storeId?: string): Promise<CampaignRow> {
  const [r] = await q.query<CampaignRow>(`${CAMPAIGN_SELECT} where c.id = $1`, [id]);
  if (!r || (storeId && r.store_id !== storeId)) throw notFound('할인을 찾을 수 없어요.');
  return r;
}

async function event(q: Queryable, campaignId: string, type: string, actor: Actor | null, payload?: unknown) {
  await q.query(`insert into campaign_events (campaign_id, type, actor_user_id, payload) values ($1, $2, $3, $4)`, [
    campaignId,
    type,
    actor?.userId ?? null,
    payload ? JSON.stringify(payload) : null,
  ]);
}

export async function listStoreCampaigns(ctx: Ctx, actor: Actor | null, storeId: string) {
  await assertOwner(ctx.db, actor, storeId);
  const rows = await ctx.db.query<CampaignRow>(`${CAMPAIGN_SELECT} where c.store_id = $1 order by c.created_at desc`, [storeId]);
  return rows.map((r) => ({ ...toCampaign(r), kindLabel: CAMPAIGN_KIND_LABEL[r.kind], reviewNote: r.review_note }));
}

export async function createCampaign(ctx: Ctx, actor: Actor | null, storeId: string, body: CampaignBody) {
  const a = await assertOwner(ctx.db, actor, storeId);
  const input = toInput(body);
  const menuIds = (await ctx.db.query<{ id: string }>(`select id from menus where store_id = $1`, [storeId])).map((m) => m.id);
  const errors = validateCampaignInput(input, menuIds);
  if (errors.length) throw validation(errors[0]!, errors);
  const status = initialCampaignStatus(input.kind);
  return ctx.db.tx(async (q) => {
    const [c] = await q.query<{ id: string }>(
      `insert into discount_campaigns (store_id, kind, title, rate, scope, daily_start_time, daily_end_time, valid_from, valid_until,
                                       max_discount_amount, min_order_amount, max_party_size, daily_limit, auto_activate, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
      [storeId, input.kind, input.title.trim(), input.rate, input.scope, input.dailyStartTime, input.dailyEndTime, input.validFrom,
        input.validUntil, input.maxDiscountAmount, input.minOrderAmount, input.maxPartySize, input.dailyLimit, body.autoActivate ?? true, status],
    );
    const id = c!.id;
    if (input.scope === 'MENUS') {
      for (const m of new Set(input.menuIds)) await q.query(`insert into discount_rules (campaign_id, menu_id) values ($1, $2)`, [id, m]);
    }
    await event(q, id, 'CREATED', a, { rate: input.rate, kind: input.kind });
    await audit(q, a, 'CAMPAIGN_CREATE', 'campaign', id, { storeId, kind: input.kind, rate: input.rate });
    if (status === 'PENDING_REVIEW') {
      const admins = await q.query<{ user_id: string }>(`select user_id from user_roles where role = 'admin'`);
      for (const ad of admins) {
        await enqueueNotification(q, ctx.now(), {
          userId: ad.user_id,
          type: 'ADMIN_CAMPAIGN_REVIEW',
          category: 'owner',
          title: '검수 대기 중인 태풍 특가가 있어요',
          body: `${input.title} (${input.rate}%)`,
          data: { campaignId: id },
        });
      }
    }
    return { ...toCampaign(await getCampaignRow(q, id)), kindLabel: CAMPAIGN_KIND_LABEL[input.kind] };
  });
}

/**
 * 캠페인 수정. 이미 확정된 예약은 reservations 의 할인 스냅샷을 사용하므로 영향받지 않는다.
 * 태풍 특가의 할인율·기간을 바꾸면 다시 검수를 받는다.
 */
export async function updateCampaign(ctx: Ctx, actor: Actor | null, storeId: string, campaignId: string, body: Partial<CampaignBody>) {
  const a = await assertOwner(ctx.db, actor, storeId);
  const cur = toCampaign(await getCampaignRow(ctx.db, campaignId, storeId));
  if (body.kind && body.kind !== cur.kind) throw validation('할인 유형은 바꿀 수 없어요. 새 할인을 만들어 주세요.');
  const merged: CampaignBody = {
    kind: cur.kind,
    title: body.title ?? cur.title,
    rate: body.rate ?? cur.rate,
    scope: body.scope ?? cur.scope,
    menuIds: body.menuIds ?? cur.menuIds,
    dailyStartTime: body.dailyStartTime ?? cur.dailyStartTime,
    dailyEndTime: body.dailyEndTime ?? cur.dailyEndTime,
    validFrom: body.validFrom ?? cur.validFrom.toISOString(),
    validUntil: body.validUntil ?? cur.validUntil.toISOString(),
    maxDiscountAmount: body.maxDiscountAmount !== undefined ? body.maxDiscountAmount : cur.maxDiscountAmount,
    minOrderAmount: body.minOrderAmount ?? cur.minOrderAmount,
    maxPartySize: body.maxPartySize ?? cur.maxPartySize,
    dailyLimit: body.dailyLimit !== undefined ? body.dailyLimit : cur.dailyLimit,
    autoActivate: body.autoActivate ?? cur.autoActivate,
  };
  const input = toInput(merged);
  const menuIds = (await ctx.db.query<{ id: string }>(`select id from menus where store_id = $1`, [storeId])).map((m) => m.id);
  const errors = validateCampaignInput(input, menuIds);
  if (errors.length) throw validation(errors[0]!, errors);
  const reReview =
    cur.kind !== 'RAIN' &&
    (input.rate !== cur.rate || input.validFrom.getTime() !== cur.validFrom.getTime() || input.validUntil.getTime() !== cur.validUntil.getTime());
  if (cur.status === 'SUSPENDED') throw conflict('운영 정책에 따라 중지된 할인은 수정할 수 없어요. 고객센터에 문의해 주세요.');
  await ctx.db.tx(async (q) => {
    await q.query(
      `update discount_campaigns set title = $2, rate = $3, scope = $4, daily_start_time = $5, daily_end_time = $6, valid_from = $7,
              valid_until = $8, max_discount_amount = $9, min_order_amount = $10, max_party_size = $11, daily_limit = $12,
              auto_activate = $13, status = case when $14 then 'PENDING_REVIEW' else status end, updated_at = now()
        where id = $1`,
      [campaignId, input.title.trim(), input.rate, input.scope, input.dailyStartTime, input.dailyEndTime, input.validFrom, input.validUntil,
        input.maxDiscountAmount, input.minOrderAmount, input.maxPartySize, input.dailyLimit, merged.autoActivate ?? true, reReview],
    );
    await q.query(`delete from discount_rules where campaign_id = $1`, [campaignId]);
    if (input.scope === 'MENUS') {
      for (const m of new Set(input.menuIds)) await q.query(`insert into discount_rules (campaign_id, menu_id) values ($1, $2)`, [campaignId, m]);
    }
    await event(q, campaignId, 'UPDATED', a, { changed: Object.keys(body), reReview });
    await audit(q, a, 'CAMPAIGN_UPDATE', 'campaign', campaignId, { storeId, changed: Object.keys(body) });
  });
  return { ...toCampaign(await getCampaignRow(ctx.db, campaignId)), kindLabel: CAMPAIGN_KIND_LABEL[cur.kind] };
}

export async function setCampaignPaused(ctx: Ctx, actor: Actor | null, storeId: string, campaignId: string, paused: boolean) {
  const a = await assertOwner(ctx.db, actor, storeId);
  await getCampaignRow(ctx.db, campaignId, storeId);
  await ctx.db.query(`update discount_campaigns set paused = $2, updated_at = now() where id = $1`, [campaignId, paused]);
  await event(ctx.db, campaignId, paused ? 'PAUSED' : 'RESUMED', a);
  await audit(ctx.db, a, paused ? 'CAMPAIGN_PAUSE' : 'CAMPAIGN_RESUME', 'campaign', campaignId, { storeId });
}

// ---------------- 관리자 ----------------

export async function adminListCampaigns(ctx: Ctx, actor: Actor | null, status?: string) {
  requireRole(actor, 'admin');
  const rows = await ctx.db.query<CampaignRow & { store_name: string }>(
    `select c.*, s.name as store_name, array(select menu_id from discount_rules d where d.campaign_id = c.id) as menu_ids
       from discount_campaigns c join stores s on s.id = c.store_id
      ${status ? 'where c.status = $1' : ''} order by c.created_at desc limit 200`,
    status ? [status] : [],
  );
  return rows.map((r) => ({ ...toCampaign(r), kindLabel: CAMPAIGN_KIND_LABEL[r.kind], storeName: r.store_name, reviewNote: r.review_note }));
}

export async function adminReviewCampaign(
  ctx: Ctx,
  actor: Actor | null,
  campaignId: string,
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND',
  note?: string,
) {
  const a = requireRole(actor, 'admin');
  const cur = await getCampaignRow(ctx.db, campaignId);
  if (decision !== 'APPROVE' && !note?.trim()) throw validation('사유를 입력해 주세요.');
  const status = { APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED' }[decision];
  const now = ctx.now();
  await ctx.db.tx(async (q) => {
    await q.query(
      `update discount_campaigns set status = $2, review_note = $3, reviewed_by = $4, reviewed_at = $5, updated_at = $5 where id = $1`,
      [campaignId, status, note ?? null, a.userId, now],
    );
    await event(q, campaignId, decision, a, { note });
    await audit(q, a, `CAMPAIGN_${decision}`, 'campaign', campaignId, { from: cur.status, to: status, note });
    const owners = await q.query<{ user_id: string }>(`select user_id from store_owners where store_id = $1`, [cur.store_id]);
    for (const o of owners) {
      await enqueueNotification(q, now, {
        userId: o.user_id,
        type: `CAMPAIGN_${decision}`,
        category: 'owner',
        title: decision === 'APPROVE' ? '할인이 승인됐어요' : '할인 검수 결과를 확인해 주세요',
        body: `${cur.title}: ${decision === 'APPROVE' ? '승인' : note}`,
        data: { campaignId },
      });
    }
  });
}
