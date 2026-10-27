export type ExportEntry = {
  id: string; project: string; archived: boolean; task: string;
  startedAt: Date; endedAt: Date;
};

function cell(value: string | number) {
  let text = String(value);
  if (typeof value === "string" && /^[\s\uFEFF]*[=+@-]/u.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function entriesCsv(entries: ExportEntry[]) {
  const rows: (string | number)[][] = [["Session ID", "Project", "Project status", "Task", "Start (UTC)", "End (UTC)", "Duration (seconds)", "Duration (hours)"]];
  for (const entry of entries) {
    const seconds = Math.max(0, entry.endedAt.getTime() - entry.startedAt.getTime()) / 1000;
    rows.push([entry.id, entry.project, entry.archived ? "Archived" : "Active", entry.task,
      entry.startedAt.toISOString(), entry.endedAt.toISOString(), seconds, seconds / 3600]);
  }
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
