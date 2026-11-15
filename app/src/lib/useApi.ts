"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON } from "./ui";

type State<T> = { data: T | null; error: string | null; loading: boolean };

export function useApi<T>(url: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: Boolean(url) });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    getJSON<T>(url).then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (err: Error) => !cancelled && setState((s) => ({ ...s, error: err.message, loading: false })),
    );
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setNonce((n) => n + 1);
  }, []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data })), []);

  return { ...state, reload, setData };
}
