import type { RunStatus } from "@/lib/agent/view";
import { cn } from "@/lib/cn";

const COLOR: Record<RunStatus, string> = { RUNNING: "bg-primary animate-pulse", DONE: "bg-success", FAILED: "bg-error" };
export const RUN_STATUS_LABEL: Record<RunStatus, string> = { RUNNING: "Running", DONE: "Done", FAILED: "Didn't finish" };

/** A run's status as a dot; decorative, so show or name the status next to it. */
export function RunDot({ status, className }: { status: RunStatus; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", COLOR[status], className)} />;
}
