import "server-only";
import { randomUUID } from "node:crypto";
import { type Db, type MongoClient, type ClientSession } from "mongodb";
import { commandSchema } from "./validation";
import type { Snapshot, TimeEntry } from "./types";
import { entriesCsv } from "./csv";

type Project = { _id: string; userId: string; name: string; key: string; updatedAt: Date; createdAt: Date; archivedAt?: Date | null };
type Task = { _id: string; userId: string; projectId: string; name: string; key: string; createdAt: Date };
type Entry = { _id: string; userId: string; projectId: string; taskId: string; startedAt: Date; endedAt: Date | null; version?: number; lastEditId?: string };
type Timer = { _id: string; activeEntryId: string | null; revision: number };

export class TimeclockError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const serializeEntry = (e: Entry): TimeEntry => ({
  id: e._id, projectId: e.projectId, taskId: e.taskId,
  startedAt: e.startedAt.toISOString(), endedAt: e.endedAt?.toISOString() ?? null, version: e.version ?? 0,
});

export function createTimeclockStore(db: Db, client: MongoClient) {
  const projects = db.collection<Project>("timeclock_projects");
  const tasks = db.collection<Task>("timeclock_tasks");
  const entries = db.collection<Entry>("timeclock_entries");
  const timers = db.collection<Timer>("timeclock_timers");
  let indexes: Promise<unknown> | undefined;

  async function ready() {
    indexes ??= Promise.all([
      projects.createIndex({ userId: 1, key: 1 }, { unique: true }),
      tasks.createIndex({ userId: 1, projectId: 1, key: 1 }, { unique: true }),
      entries.createIndex({ userId: 1, startedAt: -1 }),
      // Create the collection before using it in a transaction.
      timers.createIndex({ _id: 1 }),
    ]).catch((error) => { indexes = undefined; throw error; });
    await indexes;
  }

  async function transaction<T>(operation: (session: ClientSession) => Promise<T>) {
    await ready();
    const session = client.startSession();
    try {
      return await session.withTransaction(() => operation(session), {
        readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
        maxCommitTimeMS: 10_000,
      });
    } finally { await session.endSession(); }
  }

  async function execute(userId: string, input: unknown) {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new TimeclockError(400, "Check the name (1–120 characters) and any dates, then try again.");
    const command = parsed.data;
    return transaction(async (session) => {
      const options = { session };
      // Every mutation locks the same per-user document. Concurrent requests
      // retry against fresh state, so switching never creates overlapping timers.
      const timer = await timers.findOneAndUpdate(
        { _id: userId },
        { $inc: { revision: 1 }, $setOnInsert: { activeEntryId: null } },
        { ...options, upsert: true, returnDocument: "after" },
      );
      const now = new Date();

      if (command.action === "edit-entry") {
        const entry = await entries.findOne({ _id: command.entryId, userId }, options);
        if (!entry) throw new TimeclockError(404, "That session could not be found.");
        if (!entry.endedAt) throw new TimeclockError(409, "Stop this session before editing it.");
        if (entry.lastEditId === command.operationId) return { entryId: entry._id };
        if ((entry.version ?? 0) !== command.expectedVersion) {
          throw new TimeclockError(409, "This session changed on another device. Close and reopen the editor to load the latest version.");
        }
        const startedAt = new Date(command.startedAt);
        const endedAt = new Date(command.endedAt);
        if (endedAt <= startedAt) throw new TimeclockError(400, "End time must be after start time.");
        if (endedAt > now) throw new TimeclockError(400, "A completed session cannot end in the future.");
        const overlap = await entries.findOne({
          userId, _id: { $ne: entry._id }, startedAt: { $lt: endedAt },
          $or: [{ endedAt: null }, { endedAt: { $gt: startedAt } }],
        }, options);
        if (overlap) throw new TimeclockError(409, "These times overlap another session. Choose a time outside your other sessions.");
        let task = await tasks.findOne({ userId, projectId: entry.projectId, key: command.taskName.toLowerCase() }, options);
        if (!task) {
          task = { _id: randomUUID(), userId, projectId: entry.projectId, name: command.taskName, key: command.taskName.toLowerCase(), createdAt: now };
          await tasks.insertOne(task, options);
        }
        await entries.updateOne({ _id: entry._id, userId }, {
          $set: { taskId: task._id, startedAt, endedAt, lastEditId: command.operationId }, $inc: { version: 1 },
        }, options);
        return { entryId: entry._id };
      }

      if (command.action === "create-project") {
        const replay = await projects.findOne({ _id: command.operationId, userId }, options);
        if (replay) return { projectId: replay._id };
        const existing = await projects.findOne({ userId, key: command.name.toLowerCase() }, options);
        if (existing) {
          throw new TimeclockError(409, existing.archivedAt
            ? "An archived project already has that name. Open Archived to restore it."
            : "You already have a project with that name.");
        }
        await projects.insertOne({
          _id: command.operationId, userId, name: command.name, key: command.name.toLowerCase(),
          createdAt: now, updatedAt: now, archivedAt: null,
        }, options);
        return { projectId: command.operationId };
      }

      if (command.action === "archive-project" || command.action === "restore-project") {
        const project = await projects.findOne({ _id: command.projectId, userId }, options);
        if (!project) throw new TimeclockError(404, "That project could not be found.");
        const archive = command.action === "archive-project";
        if (archive && timer?.activeEntryId) {
          const running = await entries.findOne({
            _id: timer.activeEntryId, userId, projectId: project._id, endedAt: null,
          }, options);
          if (running) throw new TimeclockError(409, "Stop this project’s timer before archiving it.");
        }
        if (Boolean(project.archivedAt) !== archive) {
          await projects.updateOne({ _id: project._id, userId }, {
            $set: { archivedAt: archive ? now : null, updatedAt: now },
          }, options);
        }
        return { projectId: project._id };
      }

      if (command.action === "stop") {
        const entry = await entries.findOne({ _id: command.entryId, userId }, options);
        if (!entry) throw new TimeclockError(404, "That session could not be found.");
        if (entry.endedAt) return { entryId: entry._id }; // Safe to retry a stop.
        if (timer?.activeEntryId !== entry._id) {
          throw new TimeclockError(409, "The timer changed on another device. Refresh and try again.");
        }
        await entries.updateOne({ _id: entry._id, userId }, {
          $set: { endedAt: new Date(Math.max(now.getTime(), entry.startedAt.getTime())) },
        }, options);
        await timers.updateOne({ _id: userId }, { $set: { activeEntryId: null } }, options);
        return { entryId: entry._id };
      }

      // A repeated request must not restart a completed or switched session.
      const replay = await entries.findOne({ _id: command.operationId, userId }, options);
      if (replay) return { entryId: replay._id };
      const project = await projects.findOne({ _id: command.projectId, userId }, options);
      if (!project) throw new TimeclockError(404, "That project could not be found.");
      if (project.archivedAt) throw new TimeclockError(409, "Restore this project before starting a task.");
      let task = await tasks.findOne({ userId, projectId: project._id, key: command.taskName.toLowerCase() }, options);
      if (!task) {
        task = { _id: randomUUID(), userId, projectId: project._id, name: command.taskName, key: command.taskName.toLowerCase(), createdAt: now };
        await tasks.insertOne(task, options);
      }
      const active = timer?.activeEntryId
        ? await entries.findOne({ _id: timer.activeEntryId, userId, endedAt: null }, options) : null;
      // Preserve the running session if the same task is started again.
      if (active?.taskId === task._id) return { entryId: active._id };
      const startedAt = new Date(Math.max(now.getTime(), active?.startedAt.getTime() ?? 0));
      if (active) {
        await entries.updateOne({ _id: active._id, userId }, { $set: { endedAt: startedAt } }, options);
      }
      await entries.insertOne({
        _id: command.operationId, userId, projectId: project._id, taskId: task._id,
        startedAt, endedAt: null,
      }, options);
      await timers.updateOne({ _id: userId }, { $set: { activeEntryId: command.operationId } }, options);
      await projects.updateOne({ _id: project._id, userId }, { $set: { updatedAt: now } }, options);
      return { entryId: command.operationId };
    });
  }

  async function snapshot(userId: string): Promise<Snapshot> {
    // Read one consistent snapshot, even while another device switches tasks.
    return transaction(async (session) => {
      const options = { session };
      const projectList = await projects.find({ userId }, options).sort({ updatedAt: -1, _id: 1 }).toArray();
      const taskList = await tasks.find({ userId }, options).sort({ createdAt: -1 }).toArray();
      const recent = await entries.find({ userId }, options).sort({ startedAt: -1, _id: -1 }).limit(30).toArray();
      const timer = await timers.findOne({ _id: userId }, options);
      const active = timer?.activeEntryId ? await entries.findOne({ _id: timer.activeEntryId, userId, endedAt: null }, options) : null;
      const totals = await entries.aggregate<{ _id: { projectId: string; taskId: string }; completedMs: number; sessions: number }>([
        { $match: { userId } },
        { $group: {
          _id: { projectId: "$projectId", taskId: "$taskId" },
          completedMs: { $sum: { $cond: [{ $ne: ["$endedAt", null] }, { $max: [0, { $subtract: ["$endedAt", "$startedAt"] }] }, 0] } },
          sessions: { $sum: 1 },
        } },
      ], options).toArray();
      return {
        serverNow: new Date().toISOString(),
        projects: projectList.map((p) => ({
          id: p._id, name: p.name, archivedAt: p.archivedAt?.toISOString() ?? null,
          completedMs: totals.filter((t) => t._id.projectId === p._id).reduce((sum, t) => sum + t.completedMs, 0),
          sessions: totals.filter((t) => t._id.projectId === p._id).reduce((sum, t) => sum + t.sessions, 0),
        })),
        tasks: taskList.map((t) => {
          const total = totals.find((item) => item._id.taskId === t._id);
          return { id: t._id, projectId: t.projectId, name: t.name, completedMs: total?.completedMs ?? 0, sessions: total?.sessions ?? 0 };
        }),
        entries: recent.map(serializeEntry), active: active ? serializeEntry(active) : null,
      };
    });
  }
  async function exportCsv(userId: string, projectId?: string) {
    return transaction(async session => {
      const options = { session };
      const projectList = await projects.find({ userId, ...(projectId ? { _id: projectId } : {}) }, options).toArray();
      if (projectId && !projectList.length) throw new TimeclockError(404, "That project could not be found.");
      const projectMap = new Map(projectList.map(project => [project._id, project]));
      const taskList = await tasks.find({ userId, ...(projectId ? { projectId } : {}) }, options).toArray();
      const taskMap = new Map(taskList.map(task => [task._id, task.name]));
      const history = await entries.find({ userId, endedAt: { $ne: null }, ...(projectId ? { projectId } : {}) }, options).sort({ startedAt: 1, _id: 1 }).toArray();
      const csv = entriesCsv(history.map(entry => ({
        id: entry._id, project: projectMap.get(entry.projectId)?.name ?? "Unknown project",
        archived: Boolean(projectMap.get(entry.projectId)?.archivedAt), task: taskMap.get(entry.taskId) ?? "Unknown task",
        startedAt: entry.startedAt, endedAt: entry.endedAt!,
      })));
      if (Buffer.byteLength(csv, "utf8") > 4_000_000) throw new TimeclockError(413, "This export is too large. Export one project at a time.");
      return csv;
    });
  }
  return { execute, snapshot, exportCsv };
}
