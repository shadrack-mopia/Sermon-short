import { cn } from "@/lib/format";

export function Progress({
  value,
  className,
  indeterminate,
  tone = "brand",
}: {
  value: number;
  className?: string;
  indeterminate?: boolean;
  tone?: "brand" | "red" | "green";
}) {
  const v = Math.max(0, Math.min(100, value || 0));
  const bar = tone === "red" ? "bg-rose-500" : tone === "green" ? "bg-emerald-500" : "bg-brand-gradient";
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-100", className)}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", bar, indeterminate && "animate-pulse")}
        style={{ width: `${indeterminate && v < 5 ? 5 : v}%` }}
      />
    </div>
  );
}
