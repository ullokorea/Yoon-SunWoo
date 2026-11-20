// 개굴이 (청개구리 캐릭터) — 독창 디자인
// 웹(SVG)과 앱(react-native-svg)이 같은 도형 데이터를 렌더링하도록 도형 목록으로 정의한다.
// viewBox: 0 0 200 200
//
// 특징: 둥근 몸, 머리 위로 솟은 큰 눈, 민트색 배, 노란 장화, 노란 우산, 발그레한 볼.

import { colors } from './colors';

export type FrogPose = 'resting' | 'preparing' | 'jumping' | 'sheltering' | 'cheering' | 'thinking';

export type Shape =
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; opacity?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill: string; opacity?: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill: string }
  | { t: 'path'; d: string; fill?: string; stroke?: string; sw?: number; opacity?: number; anim?: 'drop' | 'sway' };

const G = colors.green;
const G2 = '#3AA65D'; // 몸 음영
const Y = colors.yellow;
const Y2 = '#E0B532';
const F = colors.forest;
const M = colors.mint;
const CHEEK = '#F4A2A6';
const RAIN = '#7FB2FF';

function base(opts: { eyes?: 'open' | 'closed' | 'up'; mouth?: 'smile' | 'open' | 'o' } = {}): Shape[] {
  const eyes = opts.eyes ?? 'open';
  const s: Shape[] = [
    { t: 'ellipse', cx: 100, cy: 184, rx: 50, ry: 7, fill: F, opacity: 0.12 },
    // 장화
    { t: 'rect', x: 66, y: 158, w: 28, h: 24, r: 9, fill: Y },
    { t: 'rect', x: 106, y: 158, w: 28, h: 24, r: 9, fill: Y },
    { t: 'rect', x: 66, y: 176, w: 30, h: 6, r: 3, fill: Y2 },
    { t: 'rect', x: 104, y: 176, w: 30, h: 6, r: 3, fill: Y2 },
    // 몸
    { t: 'ellipse', cx: 100, cy: 130, rx: 54, ry: 42, fill: G2 },
    { t: 'ellipse', cx: 100, cy: 127, rx: 54, ry: 41, fill: G },
    { t: 'ellipse', cx: 100, cy: 140, rx: 34, ry: 26, fill: M },
    // 머리
    { t: 'ellipse', cx: 100, cy: 96, rx: 62, ry: 40, fill: G },
    // 눈 언덕
    { t: 'circle', cx: 70, cy: 64, r: 22, fill: G },
    { t: 'circle', cx: 130, cy: 64, r: 22, fill: G },
    // 흰자
    { t: 'circle', cx: 70, cy: 64, r: 15, fill: '#FFFFFF' },
    { t: 'circle', cx: 130, cy: 64, r: 15, fill: '#FFFFFF' },
  ];
  if (eyes === 'closed') {
    s.push(
      { t: 'path', d: 'M60 66 Q70 74 80 66', stroke: F, sw: 4 },
      { t: 'path', d: 'M120 66 Q130 74 140 66', stroke: F, sw: 4 },
    );
  } else {
    const dy = eyes === 'up' ? -4 : 2;
    s.push(
      { t: 'circle', cx: 72, cy: 64 + dy, r: 7.5, fill: F },
      { t: 'circle', cx: 132, cy: 64 + dy, r: 7.5, fill: F },
      { t: 'circle', cx: 75, cy: 60 + dy, r: 2.6, fill: '#FFFFFF' },
      { t: 'circle', cx: 135, cy: 60 + dy, r: 2.6, fill: '#FFFFFF' },
    );
  }
  // 볼
  s.push(
    { t: 'ellipse', cx: 58, cy: 104, rx: 10, ry: 6, fill: CHEEK, opacity: 0.7 },
    { t: 'ellipse', cx: 142, cy: 104, rx: 10, ry: 6, fill: CHEEK, opacity: 0.7 },
  );
  const mouth = opts.mouth ?? 'smile';
  if (mouth === 'smile') s.push({ t: 'path', d: 'M84 106 Q100 120 116 106', stroke: F, sw: 4 });
  if (mouth === 'open') s.push({ t: 'path', d: 'M84 104 Q100 128 116 104 Z', fill: F }, { t: 'path', d: 'M92 114 Q100 122 108 114', fill: '#F27A80' });
  if (mouth === 'o') s.push({ t: 'ellipse', cx: 100, cy: 110, rx: 6, ry: 7, fill: F });
  return s;
}

const arm = (side: 'l' | 'r', up = false): Shape =>
  side === 'l'
    ? { t: 'ellipse', cx: up ? 48 : 52, cy: up ? 112 : 132, rx: 10, ry: 15, fill: G2 }
    : { t: 'ellipse', cx: up ? 152 : 148, cy: up ? 112 : 132, rx: 10, ry: 15, fill: G2 };

const drops = (pts: Array<[number, number]>): Shape[] =>
  pts.map(([x, y]) => ({ t: 'path', d: `M${x} ${y} q4 8 0 12 q-4 -4 0 -12 z`, fill: RAIN, anim: 'drop' as const }));

export function frogShapes(pose: FrogPose): Shape[] {
  switch (pose) {
    case 'resting':
      // 맑은 날: 나뭇잎 그늘 아래에서 쉬는 개굴이
      return [
        { t: 'path', d: 'M100 6 C150 6 186 30 190 52 C150 40 120 44 100 54 C80 44 50 40 10 52 C14 30 50 6 100 6 Z', fill: '#2F9A54', anim: 'sway' },
        { t: 'path', d: 'M100 8 L100 54', stroke: '#BFE8CF', sw: 3 },
        ...base({ eyes: 'closed', mouth: 'smile' }),
        arm('l'),
        arm('r'),
        { t: 'path', d: 'M160 34 q6 -6 12 0 M168 22 q5 -5 10 0', stroke: F, sw: 2.5, opacity: 0.5 },
      ];
    case 'preparing':
      // 비 예보: 접힌 우산을 챙기는 개굴이
      return [
        ...base({ eyes: 'up', mouth: 'o' }),
        arm('l'),
        { t: 'path', d: 'M156 70 L176 176', stroke: Y2, sw: 6 },
        { t: 'path', d: 'M150 66 Q160 40 172 62 L166 120 Q160 126 156 118 Z', fill: Y },
        { t: 'path', d: 'M176 176 q2 10 -8 10', stroke: F, sw: 4 },
        arm('r', true),
        ...drops([[30, 20], [52, 6]]),
      ];
    case 'jumping':
      // 비 오는 날: 우산 쓰고 신나게 뛰는 개굴이
      return [
        ...drops([[18, 70], [182, 82], [28, 130], [174, 140]]),
        { t: 'path', d: 'M100 46 L100 92', stroke: F, sw: 4 },
        { t: 'path', d: 'M28 50 Q100 -14 172 50 Q154 40 136 50 Q118 40 100 50 Q82 40 64 50 Q46 40 28 50 Z', fill: Y },
        { t: 'path', d: 'M100 4 L100 12', stroke: F, sw: 4 },
        ...base({ eyes: 'open', mouth: 'open' }),
        arm('l', true),
        arm('r', true),
        { t: 'path', d: 'M40 176 q-10 -2 -16 4 M160 176 q10 -2 16 4', stroke: F, sw: 3, opacity: 0.35 },
      ];
    case 'sheltering':
      // 태풍: 지붕 아래 실내에서 대비하는 개굴이
      return [
        { t: 'path', d: 'M14 74 L100 14 L186 74', stroke: F, sw: 8 },
        { t: 'path', d: 'M10 30 q14 -8 28 0 q-14 4 -6 12 M160 22 q14 -8 28 0 q-14 4 -6 12', stroke: colors.typhoon, sw: 3, opacity: 0.6, anim: 'sway' },
        ...base({ eyes: 'open', mouth: 'smile' }),
        // 담요
        { t: 'path', d: 'M50 132 Q100 112 150 132 L146 168 Q100 178 54 168 Z', fill: '#FFE7A3' },
        { t: 'path', d: 'M62 148 L138 148', stroke: Y2, sw: 3 },
        // 머그컵
        { t: 'rect', x: 88, y: 118, w: 24, h: 22, r: 5, fill: '#FFFFFF' },
        { t: 'path', d: 'M112 124 q8 0 8 7 q0 7 -8 7', stroke: '#FFFFFF', sw: 4 },
        { t: 'path', d: 'M96 112 q3 -6 0 -10 M104 112 q3 -6 0 -10', stroke: colors.muted, sw: 2, opacity: 0.6 },
      ];
    case 'cheering':
      // 태풍 통과 후: 동네 가게를 응원하는 개굴이
      return [
        { t: 'path', d: 'M30 30 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z', fill: Y },
        { t: 'path', d: 'M170 18 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z', fill: Y },
        { t: 'path', d: 'M160 104 L160 30', stroke: F, sw: 4 },
        { t: 'path', d: 'M160 30 L196 40 L160 54 Z', fill: colors.danger },
        { t: 'path', d: 'M172 40 q3 -4 6 0 q3 -4 6 0 q0 5 -6 8 q-6 -3 -6 -8 z', fill: '#FFFFFF' },
        ...base({ eyes: 'closed', mouth: 'open' }),
        arm('l', true),
        { t: 'ellipse', cx: 156, cy: 104, rx: 10, ry: 14, fill: G2 },
      ];
    case 'thinking':
      return [
        { t: 'circle', cx: 160, cy: 26, r: 18, fill: '#FFFFFF' },
        { t: 'circle', cx: 152, cy: 26, r: 3, fill: colors.muted },
        { t: 'circle', cx: 160, cy: 26, r: 3, fill: colors.muted },
        { t: 'circle', cx: 168, cy: 26, r: 3, fill: colors.muted },
        { t: 'circle', cx: 142, cy: 48, r: 5, fill: '#FFFFFF' },
        ...base({ eyes: 'up', mouth: 'o' }),
        arm('l'),
        arm('r', true),
      ];
  }
}

export const POSE_LABEL: Record<FrogPose, string> = {
  resting: '나뭇잎 아래에서 쉬고 있는 개굴이',
  preparing: '우산을 준비하는 개굴이',
  jumping: '우산을 쓰고 신나게 뛰는 개굴이',
  sheltering: '실내에서 태풍을 대비하는 개굴이',
  cheering: '동네 가게를 응원하는 개굴이',
  thinking: '날씨를 확인하는 개굴이',
};
