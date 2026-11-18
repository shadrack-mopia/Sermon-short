"use client";

import { useState } from "react";
import { Shield, Trash2, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, InlineError, PageHeader } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Member } from "@/lib/types";

export default function TeamPage() {
  const { me, isAdmin } = useAuth();
  const toast = useToast();
  const members = useApi<Member[]>("/api/org/members");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  return (
    <div className="animate-fade-in mx-auto max-w-4xl">
      <PageHeader
        title="Team"
        description={isAdmin ? "Add people who help with media at your church. They sign in from any device on your network." : "People in your workspace."}
        action={
          isAdmin ? (
            <Button onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" /> Add member
            </Button>
          ) : undefined
        }
      />
      {!isAdmin && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          <Shield className="h-4 w-4" /> Only owners and admins can add or remove members.
        </div>
      )}
      {members.error && !members.data ? (
        <ErrorState message={members.error} onRetry={members.reload} />
      ) : !members.data ? (
        <Skeleton className="h-48" />
      ) : members.data.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="No members" />
      ) : (
        <Card className="divide-y divide-slate-100">
          {members.data.map((m) => {
            const initials = (m.name || m.email)
              .split(/\s+/)
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase();
            const isMe = m.id === me?.user.id;
            return (
              <div key={m.id} className="flex items-center gap-3 p-4">
                <span className="bg-brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white">{initials}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-slate-900">{m.name}</span>
                    {isMe && <Badge tone="indigo">You</Badge>}
                  </div>
                  <div className="truncate text-sm text-slate-500">{m.email}</div>
                </div>
                <div className="hidden text-xs text-slate-400 sm:block">Joined {formatDate(m.created_at)}</div>
                <Badge tone={m.role === "owner" ? "violet" : m.role === "admin" ? "sky" : "slate"} className="capitalize">
                  {m.role}
                </Badge>
                {isAdmin && m.role !== "owner" && !isMe ? (
                  <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <span className="w-8" />
                )}
              </div>
            );
          })}
        </Card>
      )}

      {adding && (
        <AddMemberDialog
          onClose={() => setAdding(false)}
          onAdded={async () => {
            await members.reload();
            toast.success("Member added", "Share the email and temporary password with them in person.");
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="Their account is deactivated and they're signed out everywhere. Sermons and clips they uploaded stay in the workspace."
        confirmLabel="Remove member"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await api.del(`/api/org/members/${removing.id}`);
          await members.reload();
          toast.success("Member removed");
        }}
      />
    </div>
  );
}

function AddMemberDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return setError("Name and email are required.");
    if (form.password.length < 8) return setError("The temporary password must be at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/org/members", { name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role });
      await onAdded();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a team member"
      description="Creates their account with a temporary password. Ask them to change it in Settings."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Add member
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} autoFocus maxLength={200} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set("email")} autoComplete="off" />
        </Field>
        <Field label="Temporary password" hint="At least 8 characters.">
          <Input type="text" value={form.password} onChange={set("password")} autoComplete="new-password" minLength={8} />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={set("role")}>
            <option value="member">Member — upload and edit clips</option>
            <option value="admin">Admin — also manage team and organisation</option>
          </Select>
        </Field>
        <InlineError>{error}</InlineError>
      </form>
    </Dialog>
  );
}
