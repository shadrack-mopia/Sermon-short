"use client";

import { useState } from "react";
import { Building2, KeyRound, UserRound } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Label } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/spinner";
import { InlineError, PageHeader } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { cn, PLATFORMS } from "@/lib/format";
import type { Me, Org } from "@/lib/types";

export default function SettingsPage() {
  const { me } = useAuth();
  if (!me) return <PageLoader />;
  return (
    <div className="animate-fade-in mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Your profile, password and organisation." />
      <ProfileCard me={me} />
      <PasswordCard />
      <OrgCard org={me.org} />
    </div>
  );
}

function ProfileCard({ me }: { me: Me }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me.user.name);
  const [email, setEmail] = useState(me.user.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== me.user.name || email !== me.user.email;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<Me>("/api/auth/me", { name: name.trim(), email: email.trim() });
      setUser(res.user);
      toast.success("Profile updated");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Profile" icon={<UserRound className="h-4 w-4" />} />
      <CardBody>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
          </div>
          <InlineError>{error}</InlineError>
          <div className="flex justify-end">
            <Button type="submit" loading={busy} disabled={!dirty}>
              Save profile
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError("The new password must be at least 8 characters.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/change-password", { current_password: cur, new_password: next });
      setCur("");
      setNext("");
      setConfirm("");
      toast.success("Password changed", "Other devices have been signed out.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Change password" description="Signs you out on other devices." icon={<KeyRound className="h-4 w-4" />} />
      <CardBody>
        <form onSubmit={save} className="space-y-4">
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" hint="At least 8 characters.">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </Field>
          </div>
          <InlineError>{error}</InlineError>
          <div className="flex justify-end">
            <Button type="submit" loading={busy} disabled={!cur || !next}>
              Change password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function OrgCard({ org }: { org: Org }) {
  const { setOrg, isAdmin } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(org.name);
  const [speaker, setSpeaker] = useState(org.speaker_name ?? "");
  const [platforms, setPlatforms] = useState<string[]>(org.platforms ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== org.name || speaker !== (org.speaker_name ?? "") || JSON.stringify(platforms) !== JSON.stringify(org.platforms ?? []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Organisation name can't be empty.");
    setBusy(true);
    setError(null);
    try {
      const o = await api.patch<Org>("/api/org", { name: name.trim(), speaker_name: speaker.trim(), platforms });
      setOrg(o);
      toast.success("Organisation updated");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Organisation"
        description={isAdmin ? "Your church or ministry." : "Only owners and admins can change these."}
        icon={<Building2 className="h-4 w-4" />}
      />
      <CardBody>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={!isAdmin} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Church / ministry name">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Main speaker" hint="Pre-filled on new uploads.">
                <Input value={speaker} onChange={(e) => setSpeaker(e.target.value)} maxLength={200} />
              </Field>
            </div>
            <div>
              <Label>Platforms you post to</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const on = platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPlatforms((ps) => (on ? ps.filter((x) => x !== p) : [...ps, p]))}
                      className={cn(
                        "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed",
                        on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-slate-300",
                      )}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          </fieldset>
          <InlineError>{error}</InlineError>
          {isAdmin && (
            <div className="flex justify-end">
              <Button type="submit" loading={busy} disabled={!dirty}>
                Save organisation
              </Button>
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
