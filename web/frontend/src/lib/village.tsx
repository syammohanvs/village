import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Connection, DeviceStatus, Mode, StateEnvelope } from '../types';
import { api } from './api';
import { useDemo } from './demo';
import { useApi } from './useApi';

export interface VillageContextValue {
  envelope: StateEnvelope | null;
  status: DeviceStatus | null;
  connection: Connection | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
  mode: Mode;
  demo: boolean;
  simulator: boolean;
  connected: boolean;
  stale: boolean;
  live: boolean;
  ageMs: number | null;
  serverTime: string | null;
}

const VillageContext = createContext<VillageContextValue | null>(null);

export function VillageProvider({ children }: { children: ReactNode }) {
  const { mode, demo } = useDemo();
  const { data, error, loading, reload } = useApi<StateEnvelope>(
    ['state', mode],
    () => api.state(mode),
    { intervalMs: 2000 },
  );

  const value = useMemo<VillageContextValue>(() => {
    const connection = data?.connection ?? null;
    const status = data?.status ?? null;
    const connected = Boolean(connection?.connected);
    const stale = Boolean(connection?.stale);
    return {
      envelope: data,
      status,
      connection,
      loading,
      error,
      reload,
      mode,
      demo,
      simulator: data?.source?.kind === 'simulator',
      connected,
      stale,
      live: connected && !stale && status !== null,
      ageMs: connection?.age_ms ?? null,
      serverTime: data?.server_time ?? null,
    };
  }, [data, error, loading, reload, mode, demo]);

  return <VillageContext.Provider value={value}>{children}</VillageContext.Provider>;
}

export function useVillage(): VillageContextValue {
  const value = useContext(VillageContext);
  if (!value) throw new Error('useVillage must be used inside VillageProvider');
  return value;
}
