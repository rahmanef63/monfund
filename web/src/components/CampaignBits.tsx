"use client";

import { useEffect, useState } from "react";
import { STATE_META, type DisplayState } from "@/lib/contracts";
import { bpsToPercent, clampedProgress, formatDuration, formatMon } from "@/lib/format";

export function StateBadge({ state }: { state: DisplayState }) {
  const meta = STATE_META[state];
  return (
    <span
      title={meta.hint}
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * `historical` is for the Expired state. `totalRaised` is monotonic on-chain —
 * `refund()` deliberately never decrements it, because that value gates two state
 * transitions — so once a failed campaign has been refunded the contract holds
 * nothing while this figure still reports the full amount. Rendering that as a live
 * balance would be a lie, so in the Expired state it is labelled as the past-tense
 * total contributed and the bar is greyed out rather than reading as progress
 * toward a goal that is still reachable.
 */
export function ProgressBar({
  raised,
  goal,
  progressBps,
  historical,
}: {
  raised: bigint;
  goal: bigint;
  progressBps: bigint;
  historical?: boolean;
}) {
  const pct = clampedProgress(progressBps);
  const met = raised >= goal;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={`mono ${historical ? "text-zinc-400" : "text-zinc-200"}`}>
          {formatMon(raised)}{" "}
          <span className="text-zinc-500">
            {historical ? `contributed / ${formatMon(goal)} MON goal` : `/ ${formatMon(goal)} MON`}
          </span>
        </span>
        <span
          className={
            historical ? "shrink-0 text-zinc-500" : met ? "text-emerald-300" : "text-zinc-400"
          }
        >
          {bpsToPercent(progressBps)}
          {historical ? " of goal" : ""}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            historical ? "bg-zinc-600" : met ? "bg-emerald-400" : "bg-violet-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {historical ? (
        <p className="mt-2 text-xs text-zinc-500">
          Total ever contributed, not funds held — the goal was missed and refunds are open.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ticks locally every second off the chain-provided `timeRemaining`, so the
 * number a user reads right before contributing is the exact seconds left,
 * not a value that went stale on the last poll.
 */
export function Countdown({ seconds, className }: { seconds: bigint; className?: string }) {
  const [left, setLeft] = useState(() => Number(seconds));
  const [polled, setPolled] = useState(seconds);

  // Re-baseline during render rather than in an effect: a fresh poll must not cost
  // an extra commit, and setState-in-effect is a cascading render.
  if (polled !== seconds) {
    setPolled(seconds);
    setLeft(Number(seconds));
  }

  // Keyed on `seconds` only: depending on `left` would tear the interval down and
  // rebuild it on every tick, so each second would drift by one render's latency.
  useEffect(() => {
    if (Number(seconds) <= 0) return;
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [seconds]);

  if (left <= 0) return <span className={className}>deadline passed</span>;
  return (
    <span className={`mono ${className ?? ""}`} suppressHydrationWarning>
      {formatDuration(left)}
    </span>
  );
}
