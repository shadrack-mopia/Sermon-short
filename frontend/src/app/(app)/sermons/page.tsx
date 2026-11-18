"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Folder as FolderIcon,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Inbox,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { SermonStatusBadge } from "@/components/badges";
import { SermonThumb } from "@/components/sermon-thumb";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/spinner";
import { EmptyState, ErrorState, InlineError, PageHeader } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, qs } from "@/lib/api";
import { cn, formatDate, formatDuration, isProcessing, stageLabel } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import type { Folder, Sermon } from "@/lib/types";

type FolderFilter = "" | "none" | string;

export default function SermonsPage() {
  const toast = useToast();
  const [folder, setFolder] = useState<FolderFilter>("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const [view, setView] = useState<"grid" | "list">("grid");
  const folders = useApi<Folder[]>("/api/folders");
  const sermons = useApi<Sermon[]>(`/api/sermons${qs({ folder_id: folder, q: dq })}`, {
    poll: (d) => (d?.some((s) => isProcessing(s.status)) ? 4000 : false),
  });

  const [folderDialog, setFolderDialog] = useState<{ mode: "create" } | { mode: "rename"; folder: Folder } | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<Folder | null>(null);
  const [renaming, setRenaming] = useState<Sermon | null>(null);
  const [moving, setMoving] = useState<Sermon | null>(null);
  const [deleting, setDeleting] = useState<Sermon | null>(null);

  const refreshAll = async () => {
    await Promise.all([sermons.reload(), folders.reload()]);
  };

  const folderName = folder === "" ? "All sermons" : folder === "none" ? "Unfiled" : folders.data?.find((f) => f.id === folder)?.name ?? "Folder";
  const total = folders.data?.reduce((n, f) => n + f.sermon_count, 0);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="My Sermons"
        description="Every sermon you've uploaded, with its processing status and clips."
        action={
          <Link href="/sermons/upload" className={buttonClass("primary")}>
            <Upload className="h-4 w-4" /> Upload sermon
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* folders */}
        <aside>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Folders</span>
            <Button variant="ghost" size="icon-sm" onClick={() => setFolderDialog({ mode: "create" })} aria-label="New folder">
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          <nav className="scroll-thin flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            <FolderItem active={folder === ""} icon={<Inbox className="h-4 w-4" />} label="All sermons" onClick={() => setFolder("")} />
            <FolderItem
              active={folder === "none"}
              icon={<FolderOpen className="h-4 w-4" />}
              label="Unfiled"
              onClick={() => setFolder("none")}
            />
            {folders.data?.map((f) => (
              <FolderItem
                key={f.id}
                active={folder === f.id}
                icon={<FolderIcon className="h-4 w-4" />}
                label={f.name}
                count={f.sermon_count}
                onClick={() => setFolder(f.id)}
                menu={[
                  { label: "Rename", icon: Pencil, onClick: () => setFolderDialog({ mode: "rename", folder: f }) },
                  { label: "Delete", icon: Trash2, danger: true, onClick: () => setDeleteFolder(f) },
                ]}
              />
            ))}
            {folders.error && <p className="px-2 text-xs text-rose-600">{folders.error}</p>}
          </nav>
          {total !== undefined && folders.data && folders.data.length === 0 && (
            <p className="mt-2 hidden px-2 text-xs text-slate-400 lg:block">Create folders to organise sermons by series or year.</p>
          )}
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="Search by title or speaker…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500 sm:hidden">{folderName}</span>
              <div className="ml-auto inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  onClick={() => setView("grid")}
                  className={cn("cursor-pointer rounded-lg p-1.5", view === "grid" ? "bg-white shadow-sm" : "text-slate-500")}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setView("list")}
                  className={cn("cursor-pointer rounded-lg p-1.5", view === "list" ? "bg-white shadow-sm" : "text-slate-500")}
                  aria-label="List view"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {sermons.error && !sermons.data ? (
            <ErrorState message={sermons.error} onRetry={sermons.reload} />
          ) : !sermons.data ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="aspect-[4/3]" />
              ))}
            </div>
          ) : sermons.data.length === 0 ? (
            dq || folder ? (
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title="No sermons match"
                description={dq ? `Nothing found for “${dq}” in ${folderName}.` : `${folderName} is empty.`}
              />
            ) : (
              <EmptyState
                icon={<Upload className="h-6 w-6" />}
                title="Upload your first sermon"
                description="Drop in a full service recording. We'll transcribe it, find the strongest moments and render vertical clips."
                action={
                  <Link href="/sermons/upload" className={buttonClass("primary")}>
                    <Upload className="h-4 w-4" /> Upload sermon
                  </Link>
                }
              />
            )
          ) : view === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sermons.data.map((s) => (
                <Card key={s.id} className="group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
                  <Link href={`/sermons/${s.id}`}>
                    <SermonThumb sermon={s} />
                  </Link>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/sermons/${s.id}`} className="line-clamp-2 font-medium text-slate-900 hover:text-indigo-700">
                        {s.title}
                      </Link>
                      <RowMenu
                        items={[
                          { label: "Rename", icon: Pencil, onClick: () => setRenaming(s) },
                          { label: "Move to folder", icon: FolderInput, onClick: () => setMoving(s) },
                          { label: "Delete", icon: Trash2, danger: true, onClick: () => setDeleting(s) },
                        ]}
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{[s.speaker, formatDate(s.created_at)].filter(Boolean).join(" · ")}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <SermonStatusBadge status={s.status} />
                      {s.status === "ready" && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <Clapperboard className="h-3.5 w-3.5" /> {s.clip_count ?? 0} clips
                        </span>
                      )}
                    </div>
                    <ProcessingLine sermon={s} />
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="divide-y divide-slate-100">
              {sermons.data.map((s) => (
                <div key={s.id} className="flex items-center gap-4 p-3">
                  <Link href={`/sermons/${s.id}`} className="shrink-0">
                    <SermonThumb sermon={s} className="w-28 rounded-lg" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/sermons/${s.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-700">
                      {s.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[s.speaker, formatDuration(s.duration_s), formatDate(s.created_at)].filter((x) => x && x !== "—").join(" · ")}
                    </div>
                    <ProcessingLine sermon={s} />
                  </div>
                  <div className="hidden items-center gap-3 sm:flex">
                    {s.status === "ready" && <span className="text-xs text-slate-500">{s.clip_count ?? 0} clips</span>}
                    <SermonStatusBadge status={s.status} />
                  </div>
                  <RowMenu
                    items={[
                      { label: "Rename", icon: Pencil, onClick: () => setRenaming(s) },
                      { label: "Move to folder", icon: FolderInput, onClick: () => setMoving(s) },
                      { label: "Delete", icon: Trash2, danger: true, onClick: () => setDeleting(s) },
                    ]}
                  />
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {folderDialog && (
        <FolderDialog
          initial={folderDialog.mode === "rename" ? folderDialog.folder.name : ""}
          title={folderDialog.mode === "rename" ? "Rename folder" : "New folder"}
          onClose={() => setFolderDialog(null)}
          onSave={async (name) => {
            if (folderDialog.mode === "rename") await api.patch(`/api/folders/${folderDialog.folder.id}`, { name });
            else await api.post("/api/folders", { name });
            await folders.reload();
            toast.success(folderDialog.mode === "rename" ? "Folder renamed" : "Folder created");
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteFolder}
        onClose={() => setDeleteFolder(null)}
        title={`Delete folder “${deleteFolder?.name}”?`}
        description="The sermons inside are kept and moved to Unfiled."
        confirmLabel="Delete folder"
        danger
        onConfirm={async () => {
          if (!deleteFolder) return;
          await api.del(`/api/folders/${deleteFolder.id}`);
          if (folder === deleteFolder.id) setFolder("");
          await refreshAll();
          toast.success("Folder deleted");
        }}
      />

      {renaming && (
        <RenameSermonDialog
          sermon={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(s) => {
            sermons.setData((list) => (list ?? []).map((x) => (x.id === s.id ? { ...x, title: s.title, speaker: s.speaker } : x)));
            toast.success("Sermon updated");
          }}
        />
      )}

      {moving && (
        <MoveDialog
          sermon={moving}
          folders={folders.data ?? []}
          onClose={() => setMoving(null)}
          onMoved={async () => {
            await refreshAll();
            toast.success("Sermon moved");
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="This permanently deletes the sermon video, its transcript and all of its clips from this computer. This can't be undone."
        confirmLabel="Delete sermon"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.del(`/api/sermons/${deleting.id}`);
          await refreshAll();
          toast.success("Sermon deleted");
        }}
      />
    </div>
  );
}

function ProcessingLine({ sermon: s }: { sermon: Sermon }) {
  if (isProcessing(s.status))
    return (
      <div className="mt-3">
        <Progress value={s.progress} className="h-1.5" />
        <div className="mt-1 flex justify-between text-[11px] text-slate-500">
          <span>{stageLabel(s.stage)}</span>
          <span className="tabular-nums">{Math.round(s.progress)}%</span>
        </div>
      </div>
    );
  if (s.status === "failed" && s.error) return <p className="mt-2 line-clamp-2 text-xs text-rose-600">{s.error}</p>;
  return null;
}

function FolderItem({
  active,
  icon,
  label,
  count,
  onClick,
  menu,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
  menu?: MenuItem[];
}) {
  return (
    <div
      className={cn(
        "group flex shrink-0 items-center rounded-xl text-sm transition",
        active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-white",
      )}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2 text-left">
        <span className={active ? "text-indigo-600" : "text-slate-400"}>{icon}</span>
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="ml-auto pl-2 text-xs text-slate-400 tabular-nums">{count}</span>}
      </button>
      {menu && <RowMenu items={menu} small />}
    </div>
  );
}

interface MenuItem {
  label: string;
  icon: typeof Pencil;
  onClick: () => void;
  danger?: boolean;
}

function RowMenu({ items, small }: { items: MenuItem[]; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("cursor-pointer rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700", small ? "mr-1 p-1" : "p-1.5")}
        aria-label="More actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="animate-pop-in absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.map(({ label, icon: Icon, onClick, danger }) => (
            <button
              key={label}
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm",
                danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FolderDialog({ initial, title, onClose, onSave }: { initial: string; title: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return setError("Enter a folder name.");
    setBusy(true);
    try {
      await onSave(name.trim());
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
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Folder name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Easter series 2026" maxLength={200} />
        </Field>
        <InlineError>{error}</InlineError>
      </form>
    </Dialog>
  );
}

function RenameSermonDialog({ sermon, onClose, onSaved }: { sermon: Sermon; onClose: () => void; onSaved: (s: Sermon) => void }) {
  const [title, setTitle] = useState(sermon.title);
  const [speaker, setSpeaker] = useState(sermon.speaker ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return setError("Title can't be empty.");
    setBusy(true);
    try {
      const s = await api.patch<Sermon>(`/api/sermons/${sermon.id}`, { title: title.trim(), speaker: speaker.trim() });
      onSaved(s);
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
      title="Edit sermon"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        </Field>
        <Field label="Speaker">
          <Input value={speaker} onChange={(e) => setSpeaker(e.target.value)} maxLength={200} />
        </Field>
        <InlineError>{error}</InlineError>
      </form>
    </Dialog>
  );
}

function MoveDialog({ sermon, folders, onClose, onMoved }: { sermon: Sermon; folders: Folder[]; onClose: () => void; onMoved: () => Promise<void> }) {
  const [target, setTarget] = useState(sermon.folder_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/sermons/${sermon.id}`, { folder_id: target || null, move_folder: true });
      await onMoved();
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
      title="Move to folder"
      description={sermon.title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Move
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">No folder (Unfiled)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        {folders.length === 0 && <p className="text-xs text-slate-500">You haven&apos;t created any folders yet.</p>}
        <InlineError>{error}</InlineError>
      </div>
    </Dialog>
  );
}
