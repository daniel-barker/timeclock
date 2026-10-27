"use client";
import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowLeft, ArrowUpRight, Check, Clock3, FolderOpen, Plus, Play, Square, RefreshCw, ListChecks } from "lucide-react";
import { AuthControl } from "@/components/auth-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTimeclock } from "./use-timeclock";
import { EditEntry } from "./edit-entry";
import { ExportEntries } from "./export-entries";
import type { TimeEntry } from "@/lib/timeclock/types";
import { formatDuration, normalizeName } from "@/lib/timeclock/validation";

export function Workspace({ name }: { name: string }) {
  const { data, now, busy, syncError, actionError, lastSynced, refresh, run } = useTimeclock();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [taskName, setTaskName] = useState("");
  const [projectView, setProjectView] = useState<"active" | "archived">("active");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const selected = data?.projects.find((project) => project.id === selectedId);
  const activeProjects = data?.projects.filter((project) => !project.archivedAt) ?? [];
  const archivedProjects = data?.projects.filter((project) => project.archivedAt) ?? [];
  const visibleProjects = projectView === "archived" ? archivedProjects : activeProjects;
  const active = data?.active;
  const activeProject = data?.projects.find((project) => project.id === active?.projectId);
  const activeTask = data?.tasks.find((task) => task.id === active?.taskId);
  const elapsed = active ? Math.max(0, now - Date.parse(active.startedAt)) : 0;
  const allTime = (data?.projects.reduce((sum, project) => sum + project.completedMs, 0) ?? 0) + elapsed;
  const tasks = data?.tasks.filter((task) => task.projectId === selectedId) ?? [];
  const recent = data?.entries.filter((entry) => !selectedId || entry.projectId === selectedId) ?? [];
  const disabled = busy || Boolean(syncError) || !data;
  const sameTask = active?.projectId === selectedId && activeTask?.name.toLowerCase() === normalizeName(taskName).toLowerCase();

  function selectProject(id: string | null) { setSelectedId(id); setTaskName(""); setNewProject(false); }
  async function createProject(event: FormEvent) {
    event.preventDefault();
    const result = await run({ action: "create-project", name: projectName, operationId: crypto.randomUUID() });
    if (result?.projectId) { selectProject(result.projectId); setProjectName(""); setProjectView("active"); setNotice(""); }
  }
  async function startTask(task: string) {
    if (!selectedId || selected?.archivedAt) return;
    const result = await run({ action: "start", projectId: selectedId, taskName: task, operationId: crypto.randomUUID() });
    if (result) setTaskName(normalizeName(task));
  }
  function stop() { if (active) void run({ action: "stop", entryId: active.id }); }
  async function changeArchiveState() {
    if (!selected) return;
    const restoring = Boolean(selected.archivedAt);
    setNotice("");
    const result = await run({
      action: restoring ? "restore-project" : "archive-project", projectId: selected.id,
    });
    if (result) {
      setNotice(restoring ? `Restored “${selected.name}”.` : `Archived “${selected.name}”. You can restore it from Archived.`);
      setProjectView("active");
      if (!restoring) selectProject(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8f5] text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <button onClick={() => { selectProject(null); setProjectView("active"); }} className="flex items-center gap-3 rounded-lg text-xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-emerald-700" aria-label="Timeclock projects">
            <span className="rounded-xl bg-emerald-900 p-2 text-white"><Clock3 size={22} /></span>Timeclock
          </button>
          <div className="flex items-center gap-4"><span className="hidden text-sm text-stone-500 sm:block">{name}</span><AuthControl action="signout" /></div>
        </div>
      </header>

      {active && (
        <div className="sticky top-0 z-20 border-b border-emerald-800 bg-emerald-950 text-white shadow-sm">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <button onClick={() => selectProject(active.projectId)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open running project ${activeProject?.name}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300" />
              <span className="min-w-0"><span className="block truncate text-xs text-emerald-200">{activeProject?.name} · Tracking now</span><span className="block truncate font-medium">{activeTask?.name}</span></span>
            </button>
            <div className="flex items-center gap-5"><span className="font-mono text-2xl tabular-nums" aria-label="Elapsed time">{formatDuration(elapsed, true)}</span><Button onClick={stop} disabled={disabled} className="min-h-10 bg-white px-4 text-emerald-950 hover:bg-emerald-50"><Square className="fill-current" size={14} />Stop</Button></div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        {editing && data && <EditEntry entry={editing} projectName={data.projects.find(project => project.id === editing.projectId)?.name ?? "Project"} tasks={data.tasks.filter(task => task.projectId === editing.projectId)} busy={busy} error={actionError} offline={Boolean(syncError)} run={run} close={() => setEditing(null)} saved={() => { setEditing(null); setNotice("Session updated. Your time totals have been recalculated."); }} />}
        {notice && <p role="status" className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}
        {(syncError || actionError) && <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><span>{actionError || syncError}</span><Button variant="outline" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} />Refresh</Button></div>}
        {!data ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center" role="status"><Clock3 className="mx-auto mb-4 text-emerald-700" /><p>{syncError ? "Your workspace is temporarily unavailable." : "Loading your workspace…"}</p></div>
        ) : (
          <>
            <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
              <div>
                {selected && <button onClick={() => selectProject(null)} className="mb-4 flex items-center gap-2 text-sm text-stone-500 hover:text-emerald-800"><ArrowLeft size={15} />All projects</button>}
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Your workspace</p>
                <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{selected?.name ?? "Time, well spent."}</h1>
                <p className="mt-3 text-sm leading-6 text-stone-500">{selected?.archivedAt ? "Archived project · Your tasks and time history are preserved." : selected ? "Choose a task and give it your attention." : "Pick a project, start a task, and let the clock take care of the rest."}</p>
              </div>
              {!selected && <Button onClick={() => setNewProject(!newProject)} disabled={busy} className="min-h-11 bg-emerald-900 px-5 hover:bg-emerald-800"><Plus size={17} />New project</Button>}
              {selected && <div className="space-y-2">
                <Button onClick={() => void changeArchiveState()} variant="outline" disabled={disabled || (!selected.archivedAt && active?.projectId === selected.id)} className="min-h-11 px-5">
                  {selected.archivedAt ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                  {busy ? "Saving…" : selected.archivedAt ? "Restore project" : "Archive project"}
                </Button>
                {!selected.archivedAt && active?.projectId === selected.id && <p className="text-xs text-stone-500">Stop this project’s timer to archive it.</p>}
              </div>}
            </div>

            {newProject && <form onSubmit={createProject} className="mb-8 rounded-2xl border border-emerald-200 bg-white p-5">
              <label htmlFor="project-name" className="mb-3 block text-sm font-medium">Project name</label>
              <div className="flex flex-wrap gap-3"><Input id="project-name" autoFocus required maxLength={120} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Website redesign" className="h-11 min-w-48 flex-1" /><Button type="submit" disabled={disabled || !projectName.trim()} className="min-h-11 px-5">{busy ? "Saving…" : "Create project"}</Button><Button type="button" variant="ghost" onClick={() => setNewProject(false)} className="min-h-11">Cancel</Button></div>
            </form>}

            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label={selected ? "Project time" : "Total time tracked"} value={formatDuration(selected ? selected.completedMs + (active?.projectId === selected.id ? elapsed : 0) : allTime)} icon={<Clock3 size={17} />} />
              <Stat label={selected ? "Tasks" : "Active projects"} value={String(selected ? tasks.length : activeProjects.length)} icon={selected ? <ListChecks size={17} /> : <FolderOpen size={17} />} />
              <Stat label="Work sessions" value={String(selected ? selected.sessions : data.projects.reduce((sum, project) => sum + project.sessions, 0))} icon={<Check size={17} />} />
            </div>

            {!selected ? (
              <section aria-labelledby="projects-heading">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="projects-heading" className="text-lg font-semibold">Projects</h2><div role="group" aria-label="Project status" className="flex gap-2">
                  <Button variant={projectView === "active" ? "default" : "outline"} aria-pressed={projectView === "active"} onClick={() => setProjectView("active")} className="min-h-10">Active ({activeProjects.length})</Button>
                  <Button variant={projectView === "archived" ? "default" : "outline"} aria-pressed={projectView === "archived"} onClick={() => setProjectView("archived")} className="min-h-10"><Archive size={15} />Archived ({archivedProjects.length})</Button>
                </div></div>
                <p className="mb-4 text-xs text-stone-500">{projectView === "archived" ? "Open a project to review its time or restore it." : "Most recently worked on first"}</p>
                {data.projects.length === 0 && projectView === "active" ? <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center"><FolderOpen size={32} className="mx-auto mb-4 text-emerald-800" /><h3 className="text-xl font-semibold">A little structure. More focus.</h3><p className="mx-auto mb-6 mt-3 max-w-sm text-sm leading-6 text-stone-500">Create your first project. You can add tasks as you go, right when you start tracking.</p><Button onClick={() => setNewProject(true)} className="min-h-11 px-5"><Plus size={16} />Create your first project</Button></div> :
                  visibleProjects.length === 0 ? <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center"><Archive className="mx-auto mb-4 text-stone-400" size={28} /><h3 className="font-semibold">{projectView === "archived" ? "No archived projects" : "No active projects"}</h3><p className="mt-2 text-sm text-stone-500">{projectView === "archived" ? "Projects you archive will appear here." : "Create a new project or open Archived to restore one."}</p></div> :
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleProjects.map((project) => <button key={project.id} onClick={() => selectProject(project.id)} className="group rounded-2xl border border-stone-200 bg-white p-6 text-left transition hover:border-emerald-600 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-emerald-700">
                    <div className="mb-6 flex items-center justify-between"><span className="rounded-xl bg-stone-100 p-2.5 text-emerald-900"><FolderOpen size={20} /></span>{active?.projectId === project.id ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">Tracking</span> : <ArrowUpRight size={18} className="text-stone-400 group-hover:text-emerald-800" />}</div>
                    <h3 className="break-words text-lg font-semibold">{project.name}</h3>{project.archivedAt && <p className="mt-2 text-xs text-stone-500">Archived {new Date(project.archivedAt).toLocaleDateString()}</p>}<p className="mt-2 text-sm text-stone-500">{data.tasks.filter((task) => task.projectId === project.id).length} tasks · {project.sessions} sessions</p><div className="mt-6 border-t border-stone-100 pt-4 font-mono text-xl tabular-nums">{formatDuration(project.completedMs + (active?.projectId === project.id ? elapsed : 0))}</div>
                  </button>)}</div>}
              </section>
            ) : (
              <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_1fr]">
                {selected.archivedAt ? <section className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8">
                  <Archive className="mb-4 text-stone-500" size={28} />
                  <h2 className="text-lg font-semibold">This project is archived</h2>
                  <p className="mt-3 text-sm leading-6 text-stone-500">Archived on {new Date(selected.archivedAt).toLocaleDateString()}. You can still review task totals and recent sessions. Restore this project to start tracking again.</p>
                </section> : <section className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8">
                  <h2 className="text-lg font-semibold">What are you working on?</h2><p className="mb-6 mt-2 text-sm text-stone-500">Choose an existing task or type a new name.</p>
                  <form onSubmit={(event) => { event.preventDefault(); if (sameTask) stop(); else void startTask(taskName); }}>
                    <label htmlFor="task-name" className="mb-2 block text-sm font-medium">Task</label>
                    <Input id="task-name" list="project-tasks" required maxLength={120} autoComplete="off" value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="e.g. Research, design, or planning" className="h-12" />
                    <datalist id="project-tasks">{tasks.map((task) => <option key={task.id} value={task.name} />)}</datalist>
                    <Button type="submit" disabled={disabled || !taskName.trim()} className="mt-4 min-h-12 w-full bg-emerald-900 text-base hover:bg-emerald-800">{sameTask ? <Square size={16} /> : <Play size={16} />}{busy ? "Saving…" : sameTask ? "Stop timer" : active ? "Switch to this task" : "Start timer"}</Button>
                    <p className="mt-4 text-xs leading-5 text-stone-500">{active ? "Switching saves your current session and starts the next one." : "Close the tab whenever you need to. Your timer keeps running."}</p>
                  </form>
                </section>}
                <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                  <h2 className="border-b border-stone-100 p-6 text-lg font-semibold">Tasks in this project</h2>
                  {tasks.length === 0 ? <p className="p-6 text-sm leading-6 text-stone-500">{selected.archivedAt ? "No tasks were tracked in this project." : "Your tasks will appear here when you start tracking."}</p> : <ul className="divide-y divide-stone-100">{tasks.map((task) => <li key={task.id} className="flex items-center gap-3 px-6 py-4"><div className="min-w-0 flex-1"><p className="break-words font-medium">{task.name}</p><p className="mt-1 text-xs text-stone-500">{task.sessions} sessions{active?.taskId === task.id ? " · Tracking now" : ""}</p></div><span className="shrink-0 font-mono text-sm tabular-nums">{formatDuration(task.completedMs + (active?.taskId === task.id ? elapsed : 0))}</span>{!selected.archivedAt && <Button variant="outline" className="min-h-10 min-w-10" disabled={disabled} aria-label={active?.taskId === task.id ? `Stop ${task.name}` : `Start ${task.name}`} onClick={() => active?.taskId === task.id ? stop() : void startTask(task.name)}>{active?.taskId === task.id ? <Square size={14} /> : <Play size={14} />}</Button>}</li>)}</ul>}
                </section>
              </div>
            )}

            {recent.length > 0 && <section className="mt-10" aria-labelledby="recent-heading"><div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 id="recent-heading" className="text-lg font-semibold">Recent sessions</h2><span className="text-xs text-stone-500">From your latest 30 sessions · Local time</span></div><div className="overflow-hidden rounded-2xl border border-stone-200 bg-white"><ul className="divide-y divide-stone-100">{recent.map((entry) => {
              const task = data.tasks.find((item) => item.id === entry.taskId);
              const project = data.projects.find((item) => item.id === entry.projectId);
              return <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"><div className="min-w-0"><p className="break-words text-sm font-medium">{task?.name ?? "Task"}</p><p className="mt-1 break-words text-xs leading-5 text-stone-500">{project?.name} · {new Date(entry.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div><div className="shrink-0 text-right"><p className="font-mono text-sm tabular-nums">{formatDuration((entry.endedAt ? Date.parse(entry.endedAt) : now) - Date.parse(entry.startedAt), true)}</p>{!entry.endedAt ? <p className="mt-1 text-xs text-emerald-700">Stop to edit</p> : <Button variant="outline" className="mt-2 min-h-10" disabled={disabled} aria-label={`Edit ${task?.name ?? "session"} on ${new Date(entry.startedAt).toLocaleString()}`} onClick={() => { setNotice(""); setEditing(entry); }}>Edit</Button>}</div></li>;
            })}</ul></div></section>}
            <ExportEntries projectId={selected?.id} disabled={disabled} />
            <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5 text-xs text-stone-500"><span>One task at a time.</span><span>{syncError ? "Waiting to reconnect" : lastSynced ? "Saved to your account · Syncs every 15 seconds" : "Connecting…"}</span></footer>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-2xl border border-stone-200 bg-white px-6 py-5"><div className="mb-3 flex items-center gap-2 text-xs font-medium text-stone-500">{icon}{label}</div><p className="font-mono text-2xl tracking-tight tabular-nums">{value}</p></div>;
}
