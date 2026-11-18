"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Me } from "@/lib/types";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/spinner";
import { ErrorState, InlineError } from "@/components/ui/states";

export default function RegisterPage() {
  const router = useRouter();
  const config = useApi<{ registration_open: boolean }>("/api/auth/config");
  const [form, setForm] = useState({ name: "", email: "", password: "", org_name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      await api.post<Me>("/api/auth/register", {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        org_name: form.org_name.trim() || "My Church",
      });
      router.push("/onboarding");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (config.loading) return <PageLoader />;
  if (config.error) return <ErrorState message={config.error} onRetry={config.reload} />;
  if (config.data && !config.data.registration_open)
    return (
      <div className="animate-pop-in text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Registration is closed</h1>
        <p className="mt-2 text-sm text-slate-500">
          This Sermon Shorts server already has an owner. Ask your admin to add you from the Team page, then sign in.
        </p>
        <Link href="/login" className={buttonClass("primary", "md", "mt-6")}>
          Go to sign in
        </Link>
      </div>
    );

  return (
    <div className="animate-pop-in">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Create your workspace</h1>
      <p className="mt-1 text-sm text-slate-500">Set up Sermon Shorts for your church or ministry.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Your name" htmlFor="name">
          <Input id="name" autoComplete="name" required value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Church / ministry name" htmlFor="org">
          <Input id="org" placeholder="My Church" value={form.org_name} onChange={set("org_name")} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={set("password")}
          />
        </Field>
        <InlineError>{error}</InlineError>
        <Button type="submit" loading={busy} className="w-full" size="lg">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-800">
          Sign in
        </Link>
      </p>
    </div>
  );
}
