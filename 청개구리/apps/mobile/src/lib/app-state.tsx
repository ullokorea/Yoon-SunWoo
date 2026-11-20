// 앱 전역 상태: 로그인 사용자, 위치(또는 수동 지역), 온보딩 여부
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, loadToken, setToken } from './api';
import { storage } from './storage';

export interface Me {
  id: string;
  email: string;
  nickname: string;
  phone: string | null;
  roles: string[];
  locationConsent: boolean;
  homeRegionId: string | null;
}

export interface Place {
  lat: number;
  lng: number;
  label: string;
  source: 'gps' | 'manual';
  regionId?: string;
}

interface AppState {
  ready: boolean;
  me: Me | null;
  place: Place | null;
  onboarded: boolean;
  locationDenied: boolean;
  setOnboarded: () => Promise<void>;
  signIn: (token: string, me: Me) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  requestLocation: () => Promise<boolean>;
  setManualPlace: (p: Place) => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);
const PLACE_KEY = 'cg_place';
const ONBOARD_KEY = 'cg_onboarded';

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [onboarded, setOnb] = useState(false);
  const [locationDenied, setDenied] = useState(false);

  const refreshMe = useCallback(async () => {
    if (!(await loadToken())) return setMe(null);
    try {
      const m = await api<Me | null>('me');
      setMe(m && m.roles.includes('consumer') ? m : null);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setOnb((await storage.get(ONBOARD_KEY)) === '1');
      const saved = await storage.get(PLACE_KEY);
      if (saved) {
        try {
          setPlace(JSON.parse(saved));
        } catch {
          /* 손상된 값 무시 */
        }
      }
      await refreshMe();
      setReady(true);
    })();
  }, [refreshMe]);

  const savePlace = async (p: Place) => {
    setPlace(p);
    await storage.set(PLACE_KEY, JSON.stringify(p));
  };

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return false;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setDenied(false);
      await savePlace({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '현재 위치', source: 'gps' });
      return true;
    } catch {
      setDenied(true);
      return false;
    }
  }, []);

  const value: AppState = {
    ready,
    me,
    place,
    onboarded,
    locationDenied,
    setOnboarded: async () => {
      setOnb(true);
      await storage.set(ONBOARD_KEY, '1');
    },
    signIn: async (token, m) => {
      await setToken(token);
      setMe(m);
    },
    signOut: async () => {
      await api('auth/logout', { method: 'POST' }).catch(() => null);
      await setToken(null);
      setMe(null);
    },
    refreshMe,
    requestLocation,
    setManualPlace: savePlace,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppProvider 필요');
  return c;
}

/** 기본 위치: 위치 정보가 없을 때 시범 지역(부산 동래구 온천장) */
export const DEFAULT_PLACE: Place = { lat: 35.2203, lng: 129.083, label: '부산 동래구 온천장 (기본)', source: 'manual' };
