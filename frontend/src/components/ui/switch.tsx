"use client";
import { cn } from "@/lib/format";

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-indigo-600" : "bg-slate-300",
      )}
    >
      <span
        className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")}
      />
    </button>
  );
  if (!label) return sw;
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div>
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {description && <div className="text-xs text-slate-500">{description}</div>}
      </div>
      {sw}
    </div>
  );
}
