import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { useApp, type Me } from '@/lib/app-state';
import { Button, colors, Frog, styles, T } from '@/components/ui';

export default function Login() {
  const { signIn } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string; user: Me }>('auth/login', { body: { email, password } });
      if (!r.user.roles.includes('consumer')) {
        setErr('점주·관리자 계정은 웹 관리자에서 이용해 주세요.');
        return;
      }
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
      <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <Frog pose="jumping" size={110} />
        </View>
        <T size="sm" weight="bold">이메일</T>
        <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} accessibilityLabel="이메일" />
        <T size="sm" weight="bold">비밀번호</T>
        <TextInput style={styles.input} secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} onSubmitEditing={submit} accessibilityLabel="비밀번호" />
        {err && <T size="sm" color={colors.danger} weight="bold">{err}</T>}
        <Button title="로그인" loading={busy} disabled={!email || !password} onPress={submit} />
        <Button title="처음이에요 · 회원가입" variant="ghost" onPress={() => router.replace('/signup')} />
        {__DEV__ && <T size="xs" color={colors.subtle} style={{ textAlign: 'center' }}>개발용 샘플 계정: user@cheong.dev / cheong1234</T>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
