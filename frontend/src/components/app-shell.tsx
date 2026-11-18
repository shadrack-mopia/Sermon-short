"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  CheckCheck,
  ChevronDown,
  Clapperboard,
  Film,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  Search,
  Settings,
  Sparkles,
  Type,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import type { NotificationsResponse } from "@/lib/types";
import { AuthProvider, useAuth } from "./auth-context";
import { buttonClass } from "./ui/button";
import { PageLoader } from "./ui/spinner";
import { ErrorState } from "./ui/states";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sermons", label: "My Sermons", icon: Film },
  { href: "/clips", label: "AI Clips", icon: Clapperboard },
  { href: "/search", label: "Sermon Intelligence", icon: Search },
  { href: "/brand", label: "Brand Kit", icon: Palette },
  { href: "/templates", label: "Templates", icon: Type },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { me, error, refresh, isAdmin } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const needsOnboarding = !!me && !me.org.onboarded && isAdmin && pathname !== "/onboarding";

  useEffect(() => {
    if (needsOnboarding) router.replace("/onboarding");
  }, [needsOnboarding, router]);

  if (error && !me)
    return (
      <div className="mx-auto max-w-lg p-6 pt-24">
        <ErrorState message={error} onRetry={() => void refresh()} />
      </div>
    );
  if (!me || needsOnboarding) return <PageLoader label="Loading your workspace…" />;
  if (pathname === "/onboarding") return <>{children}</>;
  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    // close the mobile drawer on navigation
    setLastPath(pathname);
    setDrawer(false);
  }

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-slate-950/60" onClick={() => setDrawer(false)} />
          <div className="animate-slide-in absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Sidebar onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <div className="lg:pl-64">
        <TopBar onMenu={() => setDrawer(true)} />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { me } = useAuth();
  return (
    <div className="flex h-full flex-col bg-navy-900 text-slate-300">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="bg-brand-gradient flex h-9 w-9 items-center justify-center rounded-xl shadow-lg shadow-indigo-900/40">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-white">Sermon Shorts</div>
            <div className="max-w-[150px] truncate text-[11px] text-slate-400">{me?.org.name}</div>
          </div>
        </Link>
        {onClose && (
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="px-4 pb-2">
        <Link href="/sermons/upload" className={buttonClass("primary", "md", "w-full")}>
          <Upload className="h-4 w-4" /> Upload sermon
        </Link>
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (pathname.startsWith(href + "/") && href !== "/sermons") || (href === "/sermons" && pathname.startsWith("/sermons/") && pathname !== "/sermons/upload");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
              )}
            >
              <Icon className={cn("h-[18px] w-[18px] transition-colors", active ? "text-indigo-300" : "text-slate-500 group-hover:text-slate-300")} />
              {label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400" />}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/5 px-5 py-4 text-[11px] leading-relaxed text-slate-500">
        Runs entirely on your own computer. Clip scores are a guide, not a guarantee of views.
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button onClick={onMenu} className="-ml-1 cursor-pointer rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <Link href="/search" className="hidden max-w-md flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-400 transition hover:border-slate-300 sm:flex">
        <Search className="h-4 w-4" /> Search what was preached…
      </Link>
      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [ref, open, close]);
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const now = useNow();
  const { data, setData, error } = useApi<NotificationsResponse>("/api/notifications", { poll: 15000 });
  useClickOutside(ref, open, () => setOpen(false));
  const unread = data?.unread ?? 0;

  const markAll = async () => {
    try {
      await api.post("/api/notifications/read-all");
      setData((d) => ({ unread: 0, items: (d?.items ?? []).map((n) => ({ ...n, read: true })) }));
    } catch {
      /* non-critical */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative cursor-pointer rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="bg-brand-gradient absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-pop-in absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Notifications</div>
            {unread > 0 && (
              <button onClick={markAll} className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="scroll-thin max-h-96 overflow-y-auto">
            {error && !data ? (
              <p className="px-4 py-6 text-center text-sm text-rose-600">{error}</p>
            ) : !data ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Loading…</p>
            ) : data.items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                <p className="text-sm text-slate-500">You&apos;re all caught up.</p>
              </div>
            ) : (
              data.items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    if (n.link) router.push(n.link);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50",
                    !n.read && "bg-indigo-50/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : n.kind === "error" ? "bg-rose-500" : n.kind === "success" ? "bg-emerald-500" : "bg-indigo-500",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-slate-400">{timeAgo(n.created_at, now)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  if (!me) return null;
  const initials = (me.user.name || me.user.email)
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      // full page load on purpose: drops every in-memory copy of the signed-in user's data
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex cursor-pointer items-center gap-2 rounded-xl p-1.5 pr-2 transition hover:bg-slate-100">
        <span className="bg-brand-gradient flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[140px] truncate text-sm font-medium text-slate-800">{me.user.name}</span>
          <span className="block text-[11px] text-slate-500 capitalize">{me.user.role}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>
      {open && (
        <div className="animate-pop-in absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <div className="truncate text-sm font-medium text-slate-900">{me.user.name}</div>
            <div className="truncate text-xs text-slate-500">{me.user.email}</div>
          </div>
          <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Settings className="h-4 w-4 text-slate-400" /> Settings
          </Link>
          <Link href="/team" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Users className="h-4 w-4 text-slate-400" /> Team
          </Link>
          <button onClick={logout} className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
