import { describe, expect, it } from 'vitest';
import { KmaWeatherAdapter, parseAlertText, parseQrToken, signQrToken, splitSql, maskEmail, maskPhone, rateLimit, resetRateLimits } from '../src/index';

describe('기상특보 텍스트 파싱', () => {
  const now = new Date();
  const text = 'o 태풍경보 : 부산, 울산, 경상남도(거제)\no 강풍주의보 : 전라남도(여수)\no 호우주의보 : 부산';
  it('해당 구역 줄만 해석', () => {
    const a = parseAlertText(text, '부산', false, now);
    expect(a.map((x) => [x.kind, x.level])).toEqual([['TYPHOON', 'WARNING'], ['HEAVY_RAIN', 'ADVISORY']]);
  });
  it('예비특보는 PRELIMINARY', () => {
    const a = parseAlertText('o 태풍 예비특보 : 부산', '부산', true, now);
    expect(a[0]!.level).toBe('PRELIMINARY');
  });
});

describe('KMA 어댑터 (가짜 fetch)', () => {
  const region = { id: 'r', name: '테스트', nx: 98, ny: 77, warningAreaCode: '159:부산', mockScenario: null };
  const ok = (items: unknown[]) => new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: items } } } }));
  it('실황·예보·특보를 스냅샷으로 변환', async () => {
    const f = (async (url: string) => {
      if (url.includes('getUltraSrtNcst')) return ok([{ category: 'PTY', obsrValue: '1', baseDate: '20260710', baseTime: '1100' }, { category: 'RN1', obsrValue: '2.5' }]);
      if (url.includes('getUltraSrtFcst')) return ok([{ category: 'PTY', fcstValue: '1' }]);
      return ok([{ tmFc: '202607100600', t6: 'o 호우주의보 : 부산', t7: '' }]);
    }) as typeof fetch;
    const s = await new KmaWeatherAdapter('KEY', f).fetchSnapshot(region, new Date());
    expect(s.source).toBe('KMA');
    expect(s.precipitationType).toBe(1);
    expect(s.rainfall1h).toBe(2.5);
    expect(s.alerts[0]!.kind).toBe('HEAVY_RAIN');
  });
  it('오류 응답·특보 구역 미설정은 예외 (→ 상태 머신이 장애로 처리)', async () => {
    const bad = (async () => new Response('<OpenAPI_ServiceResponse>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</OpenAPI_ServiceResponse>')) as typeof fetch;
    await expect(new KmaWeatherAdapter('KEY', bad).fetchSnapshot(region, new Date())).rejects.toThrow();
    const f = (async () => ok([{ category: 'PTY', obsrValue: '0' }])) as typeof fetch;
    await expect(new KmaWeatherAdapter('KEY', f).fetchSnapshot({ ...region, warningAreaCode: null }, new Date())).rejects.toThrow(/특보 구역/);
  });
});

describe('보안 유틸', () => {
  const id = '6f1c2b8e-1111-4222-8333-944455556666';
  it('QR 서명 검증, 다른 키·변조 거부', () => {
    const t = signQrToken('secret-a', id, 'nonce');
    expect(parseQrToken('secret-a', t)).toEqual({ reservationId: id, nonce: 'nonce' });
    expect(parseQrToken('secret-b', t)).toBeNull();
    expect(parseQrToken('secret-a', t.replace('nonce', 'nonc3'))).toBeNull();
  });
  it('마스킹', () => {
    expect(maskEmail('rainyday@cheong.dev')).toBe('ra******@cheong.dev');
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
  });
  it('요청 횟수 제한', () => {
    resetRateLimits();
    const r = Array.from({ length: 6 }, () => rateLimit('k', 5, 60_000));
    expect(r).toEqual([true, true, true, true, true, false]);
  });
  it('SQL 분할 ($$ 블록·주석 고려)', () => {
    expect(splitSql("select 1; -- a;b\ndo $$ begin perform 1; end $$; select ';'")).toHaveLength(3);
  });
});
