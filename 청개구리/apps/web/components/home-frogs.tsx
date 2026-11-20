'use client';
import { Frog } from './ui';

const POSES = [
  ['resting', '맑은 날'],
  ['preparing', '비 예보'],
  ['jumping', '비 오는 날'],
  ['sheltering', '태풍 접근'],
  ['cheering', '태풍 통과 후'],
] as const;

export function HomeFrogs() {
  return (
    <div className="mt-8 flex gap-3 overflow-x-auto pb-2">
      {POSES.map(([p, label]) => (
        <figure key={p} className="flex w-28 shrink-0 flex-col items-center rounded-2xl bg-white/70 p-2">
          <Frog pose={p} size={96} />
          <figcaption className="mt-1 text-xs font-bold text-muted">{label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
