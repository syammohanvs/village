import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseApiOptions {
  enabled?: boolean;
  intervalMs?: number;
}

export interface UseApiResult<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * A deliberately small data hook. It refetches when the serialised key
 * changes, can poll on an interval, and never replaces good data with a
 * transient error.
 */
export function useApi<T>(
  key: unknown,
  fetcher: () => Promise<T>,
  options: UseApiOptions = {},
): UseApiResult<T> {
  const { enabled = true, intervalMs } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const hasDataRef = useRef(false);

  const keyText = JSON.stringify(key ?? null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = async (initial: boolean) => {
      if (initial && !hasDataRef.current) setLoading(true);
      try {
        const next = await fetcherRef.current();
        if (!cancelled) {
          setData(next);
          setError(null);
          hasDataRef.current = true;
        }
      } catch (cause) {
        if (!cancelled) setError(cause);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run(true);
    if (intervalMs && intervalMs > 0) {
      timer = setInterval(() => {
        void run(false);
      }, intervalMs);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyText, enabled, intervalMs, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading, reload };
}

/** Fires an async action and tracks pending/error state for a button. */
export function useAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(async (...args: Args): Promise<Result | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await actionRef.current(...args);
    } catch (cause) {
      setError(cause);
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: () => setError(null) };
}
