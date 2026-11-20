'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { api, ApiError } from '@/lib/api-client';
import { dt, won } from '@/lib/format';
import { Button, Card, Field, Frog, Input } from '../ui';

interface Verified {
  code: string;
  partySize: number;
  slotStartAt: string;
  discountRate: number;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  items: Array<{ name: string; quantity: number }>;
  customer: { nickname: string } | null;
}

type Outcome = { ok: true; r: Verified } | { ok: false; text: string };

export function OwnerVerify({ storeId }: { storeId: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastToken = useRef<string>('');

  async function verify(body: { token?: string; code?: string }) {
    setBusy(true);
    try {
      const r = await api<Verified>(`owner/stores/${storeId}/verify`, { body });
      setOutcome({ ok: true, r });
      setCode('');
    } catch (e) {
      setOutcome({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!camOn) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (stopped) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const c = canvas.getContext('2d', { willReadFrequently: true })!;
            c.drawImage(v, 0, 0);
            const img = c.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(img.data, img.width, img.height);
            if (qr?.data && qr.data !== lastToken.current) {
              lastToken.current = qr.data;
              void verify({ token: qr.data });
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setCamErr('카메라를 사용할 수 없어요. 브라우저 권한을 확인하거나 예약번호로 확인해 주세요.');
        setCamOn(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="QR 스캔">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-forest">
          <video ref={videoRef} className={`h-full w-full object-cover ${camOn ? '' : 'hidden'}`} muted playsInline />
          {!camOn && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-white">
              <Frog pose="jumping" size={90} />
              <p className="text-sm opacity-90">고객 앱의 예약 QR 코드를 비춰 주세요.</p>
              <Button variant="sun" onClick={() => { setCamErr(null); lastToken.current = ''; setCamOn(true); }}>카메라 켜기</Button>
            </div>
          )}
        </div>
        {camOn && <Button className="mt-2 w-full" variant="ghost" onClick={() => setCamOn(false)}>카메라 끄기</Button>}
        {camErr && <p className="mt-2 text-sm text-danger">{camErr}</p>}
      </Card>
      <div className="space-y-4">
        <Card title="예약번호로 확인">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void verify({ code: code.trim() });
            }}
          >
            <Field label="예약번호">
              <Input placeholder="CG-XXXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </Field>
            <Button className="self-end" disabled={busy || !code.trim()}>확인</Button>
          </form>
          <p className="mt-2 text-xs text-muted">방문 1시간 전부터 2시간 후까지 확인할 수 있어요. 한 예약은 한 번만 확인돼요.</p>
        </Card>
        {outcome && (
          <div role="status" className={`rounded-2xl p-5 ${outcome.ok ? 'bg-mint' : 'bg-danger-bg'}`}>
            {outcome.ok ? (
              <>
                <p className="text-lg font-extrabold text-brand-dark">✓ 방문 확인 완료</p>
                <p className="mt-1 font-bold">
                  {outcome.r.customer?.nickname} · {outcome.r.partySize}명 · <span className="font-mono">{outcome.r.code}</span>
                </p>
                <p className="text-sm text-muted">{dt(outcome.r.slotStartAt)}</p>
                <ul className="mt-2 text-sm">
                  {outcome.r.items.map((i, k) => (
                    <li key={k}>{i.name} × {i.quantity}</li>
                  ))}
                </ul>
                <p className="mt-3 rounded-xl bg-white p-3 text-sm">
                  정가 {won(outcome.r.subtotal)} − 할인 {outcome.r.discountRate}% ({won(outcome.r.discountAmount)})
                  <br />
                  <b className="text-xl">현장 결제 {won(outcome.r.totalAmount)}</b>
                </p>
              </>
            ) : (
              <p className="font-bold text-danger">✕ {outcome.text}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
