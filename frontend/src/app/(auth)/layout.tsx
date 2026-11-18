import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-navy-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 h-[28rem] w-[28rem] rounded-full bg-indigo-600/25 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="bg-brand-gradient flex h-10 w-10 items-center justify-center rounded-xl">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-white">Sermon Shorts</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight text-white">
            Every sermon,{" "}
            <span className="bg-gradient-to-r from-violet-300 to-indigo-300 bg-clip-text text-transparent">a week of shorts.</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400">
            Upload a full service and get captioned vertical clips of the most powerful moments: transcribed, scored and searchable.
            Private, on your own machine.
          </p>
        </div>
        <p className="relative text-xs text-slate-500">No subscriptions. No cloud uploads. Your sermons stay with you.</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="bg-brand-gradient flex h-9 w-9 items-center justify-center rounded-xl">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-semibold">Sermon Shorts</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
