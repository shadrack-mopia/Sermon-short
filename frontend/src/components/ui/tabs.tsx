"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  hidden?: boolean;
}

export function Tabs<V extends string>({
  value,
  onChange,
  items,
  className,
  variant = "pill",
}: {
  value: V;
  onChange: (v: V) => void;
  items: TabItem<V>[];
  className?: string;
  variant?: "pill" | "underline";
}) {
  const visible = items.filter((i) => !i.hidden);
  if (variant === "underline") {
    return (
      <div role="tablist" className={cn("scroll-thin flex gap-1 overflow-x-auto border-b border-slate-200", className)}>
        {visible.map((i) => (
          <button
            key={i.value}
            role="tab"
            type="button"
            aria-selected={value === i.value}
            onClick={() => onChange(i.value)}
            className={cn(
              "-mb-px inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition",
              value === i.value ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {i.icon}
            {i.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="tablist" className={cn("scroll-thin inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1", className)}>
      {visible.map((i) => (
        <button
          key={i.value}
          role="tab"
          type="button"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cn(
            "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
            value === i.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
          )}
        >
          {i.icon}
          {i.label}
        </button>
      ))}
    </div>
  );
}
