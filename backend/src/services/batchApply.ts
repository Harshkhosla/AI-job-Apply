import { prisma } from "../db.js";
import { planApplication, fillLinkedInApplication } from "./applications.js";

/**
 * In-memory batch-apply session. We orchestrate "plan → fill → wait for user
 * to submit → advance" sequentially across a list of jobIds. The UI polls
 * /api/batch/:id for status and presses "Next" to advance.
 */
export type BatchPhase =
  | "queued"
  | "planning"
  | "filling"
  | "awaiting_user_submit"
  | "skipped"
  | "submitted"
  | "failed"
  | "done";

export interface BatchJobState {
  jobId: string;
  applicationId?: string;
  phase: BatchPhase;
  message?: string;
  filled?: number;
  skipped?: number;
}

export interface BatchSession {
  id: string;
  jobs: BatchJobState[];
  currentIndex: number;
  status: "running" | "paused" | "done" | "cancelled";
  startedAt: Date;
  endedAt?: Date;
}

const _sessions = new Map<string, BatchSession>();
const _proceedResolvers = new Map<string, () => void>();

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function getBatch(id: string): BatchSession | null {
  return _sessions.get(id) ?? null;
}

export function listBatches(): BatchSession[] {
  return Array.from(_sessions.values()).sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
  );
}

export function cancelBatch(id: string): boolean {
  const s = _sessions.get(id);
  if (!s || s.status === "done") return false;
  s.status = "cancelled";
  // unblock any waiter so the loop can exit cleanly
  const r = _proceedResolvers.get(id);
  if (r) r();
  _proceedResolvers.delete(id);
  return true;
}

export function proceedBatch(id: string): boolean {
  const r = _proceedResolvers.get(id);
  if (!r) return false;
  r();
  _proceedResolvers.delete(id);
  return true;
}

export async function startBatch(jobIds: string[]): Promise<BatchSession> {
  if (jobIds.length === 0) throw new Error("No jobs in batch");
  if (jobIds.length > 10) throw new Error("Max 10 jobs per batch");

  const id = uid();
  const session: BatchSession = {
    id,
    jobs: jobIds.map((jobId) => ({ jobId, phase: "queued" })),
    currentIndex: -1,
    status: "running",
    startedAt: new Date(),
  };
  _sessions.set(id, session);

  // Run async — don't await
  runBatchLoop(session).catch((e) => {
    console.error("[batch] loop crashed", e);
    session.status = "done";
    session.endedAt = new Date();
  });

  return session;
}

async function runBatchLoop(session: BatchSession) {
  for (let i = 0; i < session.jobs.length; i++) {
    if ((session.status as string) === "cancelled") break;
    session.currentIndex = i;
    const state = session.jobs[i];

    try {
      state.phase = "planning";
      console.log(`[batch ${session.id}] (${i + 1}/${session.jobs.length}) planning job ${state.jobId}`);
      const app = await planApplication(state.jobId);
      state.applicationId = app.id;

      state.phase = "filling";
      console.log(`[batch ${session.id}] filling...`);
      const result = await fillLinkedInApplication(app.id);
      state.filled = result.filled.length;
      state.skipped = result.skipped.length;

      state.phase = "awaiting_user_submit";
      state.message = `Filled ${state.filled}, skipped ${state.skipped}. Review the Chromium window and click Submit, then press "Next" in the batch panel.`;
      console.log(`[batch ${session.id}] awaiting user submit + advance`);

      // Park until the user clicks "Next" in the UI (or cancels).
      session.status = "paused";
      await new Promise<void>((resolve) => {
        _proceedResolvers.set(session.id, resolve);
      });
      if ((session.status as string) === "cancelled") break;
      session.status = "running";

      state.phase = "submitted";
      state.message = "Marked as advanced.";
      // Mark application + job as applied
      await prisma.application.update({
        where: { id: app.id },
        data: { status: "submitted", submittedAt: new Date() },
      }).catch(() => undefined);
      await prisma.job.update({
        where: { id: state.jobId },
        data: { status: "applied" },
      }).catch(() => undefined);
    } catch (e: any) {
      console.error(`[batch ${session.id}] job ${state.jobId} failed:`, e?.message ?? e);
      state.phase = "failed";
      state.message = e?.message ?? String(e);
    }
  }

  session.status = (session.status as string) === "cancelled" ? "cancelled" : "done";
  session.currentIndex = -1;
  session.endedAt = new Date();
}
