"use client";
import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportEntries({ projectId, disabled }: { projectId?: string; disabled: boolean }) {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  async function download(selectedProject?: string) {
    if (pending.current) return;
    pending.current = true;
    setExporting(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (selectedProject) params.set("projectId", selectedProject);
      const response = await fetch(`/api/timeclock?${params}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Couldn’t export your sessions. Try again.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `timeclock-${selectedProject ? "project" : "all-projects"}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("CSV download started.");
    } catch (error) {
      setMessage(error instanceof Error && error.name === "Error" ? error.message : "Couldn’t download your export. Check your connection and try again.");
    } finally { pending.current = false; setExporting(false); }
  }
  return <section aria-label="Export time entries" className="mt-8 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Export your time</h2>
    <p className="mt-2 text-sm leading-6 text-stone-500">Download all completed sessions, including archived projects and older history. Times use UTC. Stop a running session to include it.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      {projectId && <Button variant="outline" disabled={disabled || exporting} onClick={() => void download(projectId)} className="min-h-11"><Download size={16} />Export this project</Button>}
      <Button variant="outline" disabled={disabled || exporting} onClick={() => void download()} className="min-h-11"><Download size={16} />{exporting ? "Preparing CSV…" : "Export all projects"}</Button>
    </div>
    {message && <p role="status" className="mt-3 text-sm text-stone-600">{message}</p>}
  </section>;
}
