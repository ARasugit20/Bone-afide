"use client";

import { useCallback, useEffect, useState } from "react";
import { peek, remember } from "./clientCache";
import { getJSON } from "./ui";

type State<T> = { data: T | null; error: string | null; loading: boolean };

export function useApi<T>(url: string | null) {
  const [state, setState] = useState<State<T>>(() => {
    const cached = url ? peek<T>(url) : undefined;
    return { data: cached ?? null, error: null, loading: Boolean(url) && cached === undefined };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    getJSON<T>(url).then(
      (data) => {
        remember(url, data);
        if (!cancelled) setState({ data, error: null, loading: false });
      },
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
  const setData = useCallback(
    (data: T) => {
      if (url) remember(url, data);
      setState((s) => ({ ...s, data }));
    },
    [url],
  );

  return { ...state, reload, setData };
}
