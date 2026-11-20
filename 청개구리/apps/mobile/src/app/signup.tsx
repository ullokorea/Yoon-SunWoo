import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { useApp, type Me } from '@/lib/app-state';
import { Button, colors, styles, T } from '@/components/ui';

function Check({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: on ? colors.green : colors.line, backgroundColor: on ? colors.green : colors.white, alignItems: 'center', justifyContent: 'center' }}>
        {on && <T size="xs" weight="heavy" color={colors.white}>✓</T>}
      </View>
      <T size="sm" style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}

export default function Signup() {
  const { signIn } = useApp();
  const [f, setF] = useState({ email: '', password: '', nickname: '' });
  const [agree, setAgree] = useState({ terms: false, privacy: false, location: false, marketing: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const all = agree.terms && agree.privacy && agree.location && agree.marketing;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string; user: Me }>('auth/signup', {
        body: { ...f, role: 'consumer', agreeTerms: agree.terms, agreePrivacy: agree.privacy, agreeLocation: agree.location, agreeMarketing: agree.marketing },
      });
      await signIn(r.token, r.user);
      router.back();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 10 }} keyboardShouldPersistTaps="handled">
        <T size="sm" weight="bold">이메일</T>
        <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} accessibilityLabel="이메일" />
        <T size="sm" weight="bold">비밀번호 (8자 이상, 영문+숫자)</T>
        <TextInput style={styles.input} secureTextEntry value={f.password} onChangeText={(v) => setF({ ...f, password: v })} accessibilityLabel="비밀번호" />
        <T size="sm" weight="bold">닉네임</T>
        <TextInput style={styles.input} maxLength={20} value={f.nickname} onChangeText={(v) => setF({ ...f, nickname: v })} accessibilityLabel="닉네임" />
        <View style={{ marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: colors.surface }}>
          <Check on={all} label="전체 동의" onPress={() => setAgree({ terms: !all, privacy: !all, location: !all, marketing: !all })} />
          <Check on={agree.terms} label="(필수) 이용약관" onPress={() => setAgree({ ...agree, terms: !agree.terms })} />
          <Check on={agree.privacy} label="(필수) 개인정보 수집·이용 — 이메일, 닉네임, 예약 내역" onPress={() => setAgree({ ...agree, privacy: !agree.privacy })} />
          <Check on={agree.location} label="(선택) 위치기반서비스 이용 — 주변 매장·날씨 확인" onPress={() => setAgree({ ...agree, location: !agree.location })} />
          <Check on={agree.marketing} label="(선택) 혜택·이벤트 알림 수신" onPress={() => setAgree({ ...agree, marketing: !agree.marketing })} />
          <T size="xs" color={colors.subtle}>약관·방침 문구는 초안이며 법률 검토 전이에요.</T>
        </View>
        {err && <T size="sm" color={colors.danger} weight="bold">{err}</T>}
        <Button title="가입하기" loading={busy} disabled={!agree.terms || !agree.privacy || !f.email || !f.password || !f.nickname} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
