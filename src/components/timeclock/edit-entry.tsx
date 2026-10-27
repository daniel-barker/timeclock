"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Command, TaskSummary, TimeEntry } from "@/lib/timeclock/types";
import { fromLocalInput, toLocalInput } from "@/lib/timeclock/local-time";
import { formatDuration } from "@/lib/timeclock/validation";

export function EditEntry({ entry, projectName, tasks, busy, error, offline, run, close, saved }: {
  entry: TimeEntry; projectName: string; tasks: TaskSummary[]; busy: boolean; error: string; offline: boolean;
  run: (command: Command) => Promise<{ entryId?: string } | null>; close: () => void; saved: () => void;
}) {
  const [taskName, setTaskName] = useState(tasks.find(task => task.id === entry.taskId)?.name ?? "");
  const [start, setStart] = useState(toLocalInput(entry.startedAt));
  const [end, setEnd] = useState(toLocalInput(entry.endedAt!));
  const [localError, setLocalError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const duration = new Date(end).getTime() - new Date(start).getTime();
  async function save(event: FormEvent) {
    event.preventDefault();
    setLocalError("");
    try {
      const startedAt = fromLocalInput(start, entry.startedAt);
      const endedAt = fromLocalInput(end, entry.endedAt!);
      if (Date.parse(endedAt) <= Date.parse(startedAt)) throw new Error("End time must be after start time.");
      setSubmitted(true);
      const result = await run({ action: "edit-entry", entryId: entry.id, taskName, startedAt, endedAt, expectedVersion: entry.version, operationId: crypto.randomUUID() });
      if (result) saved();
    } catch (error) { setLocalError(error instanceof Error ? error.message : "Check the dates and try again."); }
  }
  const message = localError || (submitted ? error : "") || (offline ? "Reconnect before saving changes." : "");
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Edit session</DialogTitle><DialogDescription>{projectName} · Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Only this session will change.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <div><label htmlFor="edit-task" className="mb-2 block font-medium">Task</label><Input id="edit-task" required maxLength={120} list="edit-tasks" value={taskName} disabled={busy} onChange={event => setTaskName(event.target.value)} /><datalist id="edit-tasks">{tasks.map(task => <option key={task.id} value={task.name} />)}</datalist><p className="mt-2 text-xs text-muted-foreground">Choose an existing task or type a new name.</p></div>
        <div><label htmlFor="edit-start" className="mb-2 block font-medium">Start time</label><Input id="edit-start" type="datetime-local" step="0.001" required value={start} disabled={busy} onChange={event => setStart(event.target.value)} className="min-w-0" /></div>
        <div><label htmlFor="edit-end" className="mb-2 block font-medium">End time</label><Input id="edit-end" type="datetime-local" step="0.001" required value={end} disabled={busy} onChange={event => setEnd(event.target.value)} className="min-w-0" /></div>
        <p className="text-sm">Duration: <span className="font-mono">{Number.isFinite(duration) && duration > 0 ? formatDuration(duration, true) : "—"}</span></p>
        {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{message}</p>}
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || offline || !taskName.trim()}>{busy ? "Saving…" : "Save changes"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
