'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { addDays, hm, kstDay, md, todayKst } from '@/lib/format';
import { Button, Card, Empty, Field, Input, Loading, Msg, useAction, useApi } from '../ui';

interface SlotRow {
  id: string;
  startAt: string;
  durationMinutes: number;
  capacity: number;
  booked: number;
  closed: boolean;
}

const HOURS = Array.from({ length: 17 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`);

export function OwnerSlots({ storeId }: { storeId: string }) {
  const { data, loading, reload } = useApi<SlotRow[]>(`owner/stores/${storeId}/slots?days=7`);
  const [days, setDays] = useState<string[]>([todayKst(), addDays(todayKst(), 1)]);
  const [times, setTimes] = useState<string[]>(['12:00', '13:00', '18:00', '19:00']);
  const [capacity, setCapacity] = useState('8');
  const [duration, setDuration] = useState('60');
  const { busy, msg, run, setMsg } = useAction();
  const next7 = Array.from({ length: 14 }, (_, i) => addDays(todayKst(), i));
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort());

  const grouped = new Map<string, SlotRow[]>();
  for (const s of data ?? []) {
    const d = kstDay(s.startAt);
    grouped.set(d, [...(grouped.get(d) ?? []), s]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card title="예약 가능 시간 만들기">
        <div className="space-y-3">
          <Field label="날짜">
            <div className="flex flex-wrap gap-1.5">
              {next7.map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays(toggle(days, d))}
                  className={`min-h-10 rounded-xl border px-2.5 text-xs font-bold ${days.includes(d) ? 'border-brand bg-mint text-brand-dark' : 'border-line text-muted'}`}>
                  {md(`${d}T00:00:00+09:00`)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="시작 시간">
            <div className="flex flex-wrap gap-1.5">
              {HOURS.map((t) => (
                <button key={t} type="button" aria-pressed={times.includes(t)} onClick={() => setTimes(toggle(times, t))}
                  className={`min-h-10 w-16 rounded-xl border text-xs font-bold ${times.includes(t) ? 'border-brand bg-mint text-brand-dark' : 'border-line text-muted'}`}>
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="시간당 정원 (명)">
              <Input inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="이용 시간 (분)">
              <Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <Msg msg={msg} />
          <Button
            disabled={busy || !days.length || !times.length}
            onClick={() =>
              run(async () => {
                const r = await api<{ created: number; skipped: number }>(`owner/stores/${storeId}/slots/generate`, {
                  body: { dates: days, times, capacity: Number(capacity), durationMinutes: Number(duration) },
                });
                reload();
                return r;
              }).then((r) => r && setMsg({ ok: true, text: `${r.created}개 시간을 만들었어요. (영업시간 밖·지난 시간 ${r.skipped}개 건너뜀)` }))
            }
          >
            시간 만들기
          </Button>
          <p className="text-xs text-muted">영업시간 밖이거나 지난 시간은 건너뛰어요. 이미 있는 시간은 정원만 바뀌고, 예약된 인원보다 작게 줄일 수는 없어요.</p>
        </div>
      </Card>
      <Card title="앞으로 7일" action={<Button size="sm" variant="ghost" onClick={reload}>새로고침</Button>}>
        {loading ? (
          <Loading />
        ) : grouped.size === 0 ? (
          <Empty title="예약 가능 시간이 없어요" sub="왼쪽에서 시간을 만들어 주세요." pose="preparing" />
        ) : (
          <div className="space-y-4">
            {[...grouped].map(([d, slots]) => (
              <div key={d}>
                <p className="mb-1.5 text-sm font-bold">{md(`${d}T00:00:00+09:00`)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.id}
                      disabled={busy}
                      onClick={() => run(async () => { await api(`owner/stores/${storeId}/slots/${s.id}/close`, { body: { closed: !s.closed } }); reload(); })}
                      title={s.closed ? '눌러서 다시 열기' : '눌러서 마감하기'}
                      className={`min-h-12 rounded-xl border px-2.5 text-left text-xs ${s.closed ? 'border-line bg-surface text-subtle line-through' : s.booked >= s.capacity ? 'border-danger/30 bg-danger-bg text-danger' : 'border-line bg-white'}`}
                    >
                      <b className="block text-sm">{hm(s.startAt)}</b>
                      {s.booked}/{s.capacity}명{s.closed && ' · 마감'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
