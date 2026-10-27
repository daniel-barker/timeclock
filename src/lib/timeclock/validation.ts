import { z } from "zod";

export function normalizeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
const name = z.string().max(500).transform(normalizeName).pipe(z.string().min(1).max(120));
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit-entry"), entryId: z.uuid(), taskName: name, startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), expectedVersion: z.number().int().nonnegative(), operationId: z.uuid() }),
  z.object({ action: z.literal("create-project"), name, operationId: z.uuid() }),
  z.object({ action: z.literal("start"), projectId: z.uuid(), taskName: name, operationId: z.uuid() }),
  z.object({ action: z.literal("stop"), entryId: z.uuid() }),
  z.object({ action: z.literal("archive-project"), projectId: z.uuid() }),
  z.object({ action: z.literal("restore-project"), projectId: z.uuid() }),
]);

export function formatDuration(ms: number, seconds = false) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return seconds
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    : `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
