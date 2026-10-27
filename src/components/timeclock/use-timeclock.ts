"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, Snapshot } from "@/lib/timeclock/types";

export function useTimeclock() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [actionError, setActionError] = useState("");
  const [lastSynced, setLastSynced] = useState(0);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const clock = useRef({ server: 0, local: 0 });

  const refresh = useCallback(async (force = false) => {
    if (busyRef.current && !force) return false;
    const request = ++generation.current;
    try {
      const response = await fetch("/api/timeclock", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (response.status === 401) { window.location.reload(); return false; }
      if (!response.ok) throw new Error("Sync failed");
      const snapshot: Snapshot = await response.json();
      if (!mounted.current || request !== generation.current) return false;
      clock.current = { server: Date.parse(snapshot.serverNow), local: performance.now() };
      setNow(clock.current.server);
      setData(snapshot);
      setLastSynced(Date.now());
      setSyncError("");
      return true;
    } catch {
      if (mounted.current && request === generation.current) {
        setSyncError("Connection lost. A running timer keeps tracking. Reconnect to make changes.");
      }
      return false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onOnline = () => { void refresh(); };
    const poll = setInterval(onVisible, 15_000);
    const tick = setInterval(() => {
      if (clock.current.server) setNow(clock.current.server + performance.now() - clock.current.local);
    }, 1000);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(poll); clearInterval(tick);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function run(command: Command) {
    if (busyRef.current) return null;
    busyRef.current = true;
    generation.current++; // Ignore older reads that finish after this mutation.
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch("/api/timeclock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command), signal: AbortSignal.timeout(25_000),
      });
      if (response.status === 401) { window.location.reload(); return null; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t save that change.");
      await refresh(true);
      return result as { projectId?: string; entryId?: string };
    } catch (error) {
      // Reconcile with the server: a timed-out write may have committed.
      await refresh(true);
      setActionError(error instanceof Error && error.name === "Error"
        ? error.message : "Couldn’t confirm that change. Check the timer before trying again.");
      return null;
    } finally { busyRef.current = false; setBusy(false); }
  }
  return { data, now, busy, syncError, actionError, lastSynced, refresh, run };
}
