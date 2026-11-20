// 지역 선택 (위치 권한 거부 시 수동 선택)
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useData } from '@/lib/hooks';
import { Button, Card, colors, ErrorView, Loading, T, themeOf } from '@/components/ui';

interface Region { id: string; name: string; lat: number; lng: number; mode: string; isMock: boolean }

export default function RegionPicker() {
  const { setManualPlace, requestLocation, locationDenied, me } = useApp();
  const { data, loading, error, reload } = useData<Region[]>('regions');
  const [busy, setBusy] = useState(false);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      <Button
        title="📍 현재 위치 사용"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          const ok = await requestLocation();
          setBusy(false);
          if (ok) router.back();
        }}
      />
      {locationDenied && <T size="sm" color={colors.muted}>위치 권한이 거부됐어요. 기기 설정에서 허용하거나 아래에서 지역을 선택해 주세요.</T>}
      <T weight="bold" style={{ marginTop: 8 }}>서비스 지역</T>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorView message={error.message} onRetry={reload} />
      ) : (
        data?.map((r) => {
          const th = themeOf(r.mode);
          return (
            <Card
              key={r.id}
              label={r.name}
              onPress={async () => {
                await setManualPlace({ lat: r.lat, lng: r.lng, label: r.name, source: 'manual', regionId: r.id });
                if (me) {
                  await api('me', { method: 'PATCH', body: { homeRegionId: r.id } }).catch(() => null);
                }
                router.back();
              }}
            >
              <T weight="bold">{r.name}</T>
              <T size="sm" color={th.accent}>{th.emoji} {th.label}{r.isMock ? ' (MOCK)' : ''}</T>
            </Card>
          );
        })
      )}
      <T size="xs" color={colors.subtle}>지역을 선택하면 해당 지역의 비 소식 알림을 받을 수 있어요 (알림 설정에서 변경).</T>
    </ScrollView>
  );
}
