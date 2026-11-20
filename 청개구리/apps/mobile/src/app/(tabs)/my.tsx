import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, Switch, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useData } from '@/lib/hooks';
import { Button, Card, colors, Frog, Screen, styles, T } from '@/components/ui';

interface Prefs {
  rainAlerts: boolean;
  favoriteAlerts: boolean;
  typhoonAlerts: boolean;
  reservationAlerts: boolean;
  marketing: boolean;
  pushRegistered: boolean;
}

const PREF_LABEL: Array<[keyof Prefs, string]> = [
  ['rainAlerts', '우리 동네 비 시작 알림'],
  ['favoriteAlerts', '관심 매장 할인 알림'],
  ['typhoonAlerts', '태풍 특가 예고·오픈 알림'],
  ['reservationAlerts', '예약 확정·변경·방문 알림'],
  ['marketing', '(선택) 혜택·이벤트 알림'],
];

const confirmAsync = (title: string, msg: string) =>
  new Promise<boolean>((resolve) => {
    if (Platform.OS === 'web') return resolve(globalThis.confirm?.(`${title}\n${msg}`) ?? false);
    Alert.alert(title, msg, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: '확인', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });

export default function My() {
  const { me, place, signOut, refreshMe } = useApp();
  const prefs = useData<Prefs>(me ? 'notification-preferences' : null);
  const [withdrawPw, setWithdrawPw] = useState('');
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [report, setReport] = useState('');

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <T size="xl" weight="heavy">마이페이지</T>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Frog pose={me ? 'cheering' : 'resting'} size={64} />
          {me ? (
            <View style={{ flex: 1 }}>
              <T weight="bold" size="lg">{me.nickname}님</T>
              <T size="sm" color={colors.muted}>{me.email}</T>
            </View>
          ) : (
            <View style={{ flex: 1, gap: 6 }}>
              <T weight="bold">로그인하고 예약해 보세요</T>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Button title="로그인" small onPress={() => router.push('/login')} />
                <Button title="회원가입" small variant="secondary" onPress={() => router.push('/signup')} />
              </View>
            </View>
          )}
        </Card>

        <Card style={{ gap: 4 }}>
          <T weight="bold">위치 설정</T>
          <T size="sm" color={colors.muted}>{place ? `${place.label} (${place.source === 'gps' ? '현재 위치' : '직접 선택'})` : '설정 안 함 — 기본 지역 사용 중'}</T>
          <Button title="지역 변경" small variant="ghost" style={{ alignSelf: 'flex-start', marginTop: 4 }} onPress={() => router.push('/region')} />
        </Card>

        {me && prefs.data && (
          <Card style={{ gap: 2 }}>
            <T weight="bold">알림 설정</T>
            {!prefs.data.pushRegistered && <T size="xs" color={colors.mock}>푸시 알림은 아직 연동 전이에요 (MOCK). 알림은 앱 내 알림함으로 받아요.</T>}
            {PREF_LABEL.map(([k, l]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                <T size="sm">{l}</T>
                <Switch
                  accessibilityLabel={l}
                  value={!!prefs.data![k]}
                  trackColor={{ true: colors.green, false: colors.line }}
                  onValueChange={async (v) => {
                    prefs.setData({ ...prefs.data!, [k]: v });
                    await api('notification-preferences', { method: 'PATCH', body: { [k]: v } }).catch(prefs.reload);
                  }}
                />
              </View>
            ))}
          </Card>
        )}

        {me && (
          <Card style={{ gap: 8 }}>
            <T weight="bold">고객센터 · 신고</T>
            <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }]} multiline maxLength={2000} placeholder="할인이 다르게 적용됐거나 불편한 점을 알려주세요." value={report} onChangeText={setReport} accessibilityLabel="문의 내용" />
            <Button
              title="문의 보내기"
              small
              variant="secondary"
              disabled={!report.trim()}
              onPress={async () => {
                try {
                  await api('reports', { body: { type: 'INQUIRY', content: report } });
                  setReport('');
                  setMsg('문의를 접수했어요. 운영팀이 확인할게요.');
                } catch (e) {
                  setMsg((e as Error).message);
                }
              }}
            />
          </Card>
        )}

        <Card style={{ gap: 6 }}>
          <T weight="bold">약관 및 정책</T>
          <T size="sm" color={colors.muted}>이용약관 · 개인정보 처리방침 · 위치기반서비스 이용약관 (초안 — 법률 검토 전, 출시 전 확정 필요)</T>
          <T size="sm" color={colors.muted}>수집 항목: 이메일, 닉네임, (선택) 휴대폰 번호, 예약 내역, (동의 시) 위치. 위치 좌표는 서버에 저장하지 않고 조회에만 사용해요.</T>
        </Card>

        {msg && <T size="sm" weight="bold" color={colors.greenDark}>{msg}</T>}

        {me && (
          <View style={{ gap: 8 }}>
            <Button title="로그아웃" variant="ghost" onPress={signOut} />
            {!showWithdraw ? (
              <Button title="회원 탈퇴" variant="danger" small onPress={() => setShowWithdraw(true)} />
            ) : (
              <Card style={{ gap: 8 }}>
                <T size="sm">탈퇴하면 이메일·닉네임·연락처·즐겨찾기·알림이 즉시 삭제되고, 예정된 예약은 취소돼요. 매장 정산을 위한 예약 기록은 개인 식별 정보 없이 보관돼요.</T>
                <TextInput style={styles.input} secureTextEntry placeholder="비밀번호 확인" value={withdrawPw} onChangeText={setWithdrawPw} accessibilityLabel="비밀번호 확인" />
                <Button
                  title="탈퇴하기"
                  variant="danger"
                  disabled={!withdrawPw}
                  onPress={async () => {
                    if (!(await confirmAsync('정말 탈퇴할까요?', '되돌릴 수 없어요.'))) return;
                    try {
                      await api('me/withdraw', { body: { password: withdrawPw } });
                      await signOut();
                      await refreshMe();
                      setShowWithdraw(false);
                      setMsg('탈퇴가 완료됐어요. 그동안 고마웠어요 🐸');
                    } catch (e) {
                      setMsg((e as Error).message);
                    }
                  }}
                />
              </Card>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
