"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { CampaignState, displayState, type CampaignSummary } from "@/lib/contracts";
import { formatDeadline, formatMon, sanitizeOnchainText, shortAddress } from "@/lib/format";
import { Countdown, ProgressBar, StateBadge } from "./CampaignBits";

export function CampaignCard({ summary }: { summary: CampaignSummary }) {
  const { address } = useAccount();
  const isContributor = summary.accountContribution > 0n || summary.accountRefunded;
  const state = displayState(summary, isContributor);
  const isCreator = !!address && address.toLowerCase() === summary.creator.toLowerCase();

  return (
    <Link
      href={`/campaign/${summary.campaign}`}
      className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-600"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 min-w-0 break-words text-sm font-medium text-zinc-100">
          {sanitizeOnchainText(summary.description)}
        </p>
        <StateBadge state={state} />
      </div>

      <div className="mt-4">
        <ProgressBar
          raised={summary.totalRaised}
          goal={summary.goal}
          progressBps={summary.progressBps}
          historical={summary.state === CampaignState.Expired}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-y-1 text-xs text-zinc-500">
        <dt>Time left</dt>
        <dd className="text-right text-zinc-300">
          <Countdown seconds={summary.timeRemaining} />
        </dd>
        <dt>Deadline</dt>
        <dd className="text-right text-zinc-400">{formatDeadline(summary.deadline)}</dd>
        <dt>Creator</dt>
        <dd className="mono text-right text-zinc-400">
          {shortAddress(summary.creator)}
          {isCreator ? <span className="ml-1 text-violet-300">(you)</span> : null}
        </dd>
        {isContributor ? (
          <>
            <dt>You contributed</dt>
            <dd className="mono text-right text-zinc-300">
              {formatMon(summary.accountContribution)} MON
            </dd>
          </>
        ) : null}
      </dl>
    </Link>
  );
}
