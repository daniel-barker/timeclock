export type ProjectSummary = {
  id: string; name: string; completedMs: number; sessions: number; archivedAt: string | null;
};
export type TaskSummary = {
  id: string; projectId: string; name: string; completedMs: number; sessions: number;
};
export type TimeEntry = {
  id: string; projectId: string; taskId: string;
  startedAt: string; endedAt: string | null; version: number;
};
export type Snapshot = {
  serverNow: string;
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  entries: TimeEntry[];
  active: TimeEntry | null;
};
export type Command =
  | { action: "edit-entry"; entryId: string; taskName: string; startedAt: string; endedAt: string; expectedVersion: number; operationId: string }
  | { action: "create-project"; name: string; operationId: string }
  | { action: "archive-project" | "restore-project"; projectId: string }
  | { action: "start"; projectId: string; taskName: string; operationId: string }
  | { action: "stop"; entryId: string };
