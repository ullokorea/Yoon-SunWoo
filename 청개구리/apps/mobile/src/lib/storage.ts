// 토큰·설정 저장소: 네이티브는 SecureStore(키체인/키스토어), 웹 미리보기는 localStorage
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const web = {
  get: async (k: string) => {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  set: async (k: string, v: string) => {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {
      /* 저장 불가 환경 */
    }
  },
  remove: async (k: string) => {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {
      /* noop */
    }
  },
};

const native = {
  get: (k: string) => SecureStore.getItemAsync(k),
  set: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  remove: (k: string) => SecureStore.deleteItemAsync(k),
};

export const storage = Platform.OS === 'web' ? web : native;
