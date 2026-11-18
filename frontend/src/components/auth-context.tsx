"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Me, Org, User } from "@/lib/types";

interface AuthState {
  me: Me | null;
  error: string | null;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
  setOrg: (o: Org) => void;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

/** Loads /api/auth/me once. A 401 makes the API client redirect to /login. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>("/api/auth/me");
      setMe(m);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<Me>("/api/auth/me")
      .then((m) => {
        if (alive) setMe(m);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const setUser = useCallback((u: User) => setMe((m) => (m ? { ...m, user: { ...u, role: u.role ?? m.user.role } } : m)), []);
  const setOrg = useCallback((o: Org) => setMe((m) => (m ? { ...m, org: o } : m)), []);
  const isAdmin = me?.user.role === "owner" || me?.user.role === "admin";

  return <Ctx.Provider value={{ me, error, refresh, setUser, setOrg, isAdmin }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
}

/** For pages rendered inside the authed shell, where `me` is guaranteed. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("useMe used before auth loaded");
  return me;
}
