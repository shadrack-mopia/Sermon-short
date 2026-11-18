"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "./api";

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  status: number | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * GET `path` (null = skip). `poll` is an interval in ms, or a function of the
 * latest data returning an interval or false (e.g. poll only while processing).
 * Polling pauses while the tab is hidden. Errors during polling keep the old data.
 */
export function useApi<T>(path: string | null, opts: { poll?: number | ((data: T | undefined) => number | false) } = {}): ApiState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const pollRef = useRef(opts.poll);
  const dataRef = useRef<T | undefined>(undefined);
  const seq = useRef(0);

  useEffect(() => {
    pollRef.current = opts.poll;
  });

  const fetchNow = useCallback(async (p: string) => {
    const my = ++seq.current;
    try {
      const d = await api.get<T>(p);
      if (my !== seq.current) return;
      dataRef.current = d;
      setDataState(d);
      setError(null);
      setStatus(200);
    } catch (e) {
      if (my !== seq.current) return;
      setError(errorMessage(e));
      setStatus(e instanceof ApiError ? e.status : null);
    } finally {
      if (my === seq.current) setLoadedPath(p);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const interval = () => {
      const p = pollRef.current;
      return typeof p === "function" ? p(dataRef.current) : p;
    };
    // While polling isn't needed, keep a cheap local watcher so polling resumes when
    // local updates (setData after a save) put the data back into a pollable state.
    const idle = () => {
      if (cancelled) return;
      if (pollRef.current === undefined) return; // this hook never polls
      if (interval()) void loop();
      else timer = setTimeout(idle, 1000);
    };
    const loop = async () => {
      // always do the first load (pages opened in a background tab must still load);
      // later polls are skipped while the tab is hidden
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (!hidden || dataRef.current === undefined) await fetchNow(path);
      if (cancelled) return;
      const ms = interval();
      timer = ms ? setTimeout(loop, ms) : setTimeout(idle, 1000);
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === "visible" && pollRef.current !== undefined) void fetchNow(path);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, fetchNow]);

  const reload = useCallback(async () => {
    if (path) await fetchNow(path);
  }, [path, fetchNow]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => {
      const next = typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater;
      dataRef.current = next;
      return next;
    });
  }, []);

  const loading = !!path && loadedPath !== path && data === undefined;
  return { data: path ? data : undefined, error, status, loading, reload, setData };
}

/** Debounce a value (e.g. search box). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A clock that ticks every `ms` — for "time ago" labels without impure renders. */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
