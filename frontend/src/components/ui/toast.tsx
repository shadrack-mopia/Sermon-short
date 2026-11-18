"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/format";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

export interface ToastApi {
  toast: (t: { title: string; description?: string; kind?: ToastKind }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    ({ title, description, kind = "info" }: { title: string; description?: string; kind?: ToastKind }) => {
      const id = nextId++;
      setItems((xs) => [...xs.slice(-3), { id, kind, title, description }]);
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  const value = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, kind: "success" }),
      error: (title, description) => toast({ title, description, kind: "error" }),
    }),
    [toast],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:right-0 sm:left-auto sm:items-end">
        {items.map((t) => {
          const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
          return (
            <div
              key={t.id}
              className="animate-pop-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg"
              role="status"
            >
              <Icon
                className={cn(
                  "mt-0.5 h-5 w-5 shrink-0",
                  t.kind === "success" ? "text-emerald-500" : t.kind === "error" ? "text-rose-500" : "text-indigo-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900">{t.title}</div>
                {t.description && <div className="mt-0.5 text-sm break-words text-slate-500">{t.description}</div>}
              </div>
              <button className="cursor-pointer text-slate-400 hover:text-slate-700" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}
