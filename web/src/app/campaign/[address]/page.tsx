"use client";

import Link from "next/link";
import { use } from "react";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { CampaignActions } from "@/components/CampaignActions";
import { Countdown, ProgressBar, StateBadge } from "@/components/CampaignBits";
import { explorerAddress } from "@/lib/chain";
import { CampaignState, displayState, isFactoryConfigured, STATE_META } from "@/lib/contracts";
import { formatDeadline, formatMon, sanitizeOnchainText, shortAddress } from "@/lib/format";
import { useCampaign, useIsKnownCampaign } from "@/lib/useCampaigns";
import { describeError } from "@/lib/useTxFlow";

export default function CampaignPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = use(params);
  const campaign = isAddress(raw) ? (raw as Address) : undefined;

  const { address: account } = useAccount();
  const { summary, isLoading, error, refetch } = useCampaign(campaign);
  const { isKnown, isLoading: knownLoading, error: knownError } = useIsKnownCampaign(campaign);

  if (!campaign) return <Notice>Not a valid contract address.</Notice>;

  /*
   * Factory provenance gates this entire page, and it fails CLOSED: nothing that
   * could be mistaken for a campaign — and in particular no action UI — renders
   * unless the Factory affirmatively confirms it deployed this address. The three
   * non-confirmed answers are kept distinct so the user is never left believing an
   * unchecked contract was checked.
   */
  if (knownLoading) return <Notice>Checking this contract against the MonFund Factory…</Notice>;
  if (isKnown === false)
    return (
      <Notice tone="error">
        This contract was not deployed by the MonFund Factory. Refusing to render it as a campaign.
      </Notice>
    );
  if (isKnown !== true)
    return (
      <Notice tone="error">
        Could not verify this contract against the MonFund Factory
        {isFactoryConfigured ? "" : " — NEXT_PUBLIC_FACTORY_ADDRESS is not set"}. Nothing is shown
        until provenance is confirmed.
        {knownError ? (
          <span className="mono mt-2 block break-words text-xs opacity-70">
            {describeError(knownError)}
          </span>
        ) : null}
      </Notice>
    );

  if (isLoading) return <Notice>Loading campaign…</Notice>;
  // `error` deliberately does NOT gate the subtree: TanStack keeps the last good
  // `data` when a background poll fails, and unmounting here would take an in-flight
  // TxConfirmDialog — possibly holding a broadcast-but-unconfirmed tx — with it.
  if (!summary)
    return <Notice tone="error">Could not read this campaign on Monad testnet.</Notice>;

  // The contract's self-reported address must match the one we verified with the
  // Factory and send every transaction to; otherwise this page would render a
  // hostile contract under some other campaign's identity.
  if (summary.campaign.toLowerCase() !== campaign.toLowerCase())
    return (
      <Notice tone="error">
        This contract reports a different address than the one being read. Refusing to render it.
      </Notice>
    );

  const isContributor = summary.accountContribution > 0n || summary.accountRefunded;
  const state = displayState(summary, isContributor);
  const isCreator = !!account && account.toLowerCase() === summary.creator.toLowerCase();
  // `totalRaised` is monotonic on-chain (refunds never decrement it), so once the
  // campaign has expired unfunded it is a historical total, not a current balance.
  const expired = summary.state === CampaignState.Expired;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← All campaigns
      </Link>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
          Could not refresh this campaign from Monad testnet — showing the last successful read.
        </p>
      ) : null}

      <header className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 break-words text-xl font-semibold leading-snug">
            {sanitizeOnchainText(summary.description)}
          </h1>
          <StateBadge state={state} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">{STATE_META[state].hint}</p>

        <div className="mt-6">
          <ProgressBar
            raised={summary.totalRaised}
            goal={summary.goal}
            progressBps={summary.progressBps}
            historical={expired}
          />
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Time remaining">
            <Countdown seconds={summary.timeRemaining} className="text-zinc-100" />
          </Field>
          <Field label="Deadline">{formatDeadline(summary.deadline)}</Field>
          <Field label="Goal">
            <span className="mono">{formatMon(summary.goal)} MON</span>
          </Field>
          <Field label={expired ? "Contributed (goal not reached)" : "Raised"}>
            <span className="mono">{formatMon(summary.totalRaised)} MON</span>
            {expired ? (
              <span className="ml-2 text-xs text-zinc-500">(refunds open — not held here)</span>
            ) : null}
          </Field>
          <Field label="Creator">
            <a
              href={explorerAddress(summary.creator)}
              target="_blank"
              rel="noreferrer"
              className="mono underline underline-offset-2"
            >
              {shortAddress(summary.creator)}
            </a>
            {isCreator ? <span className="ml-1 text-violet-300">(you)</span> : null}
          </Field>
          <Field label="Contract">
            {/* The route param — the address we verified and transact against — not
                the address the contract reports about itself. */}
            <a
              href={explorerAddress(campaign)}
              target="_blank"
              rel="noreferrer"
              className="mono underline underline-offset-2"
            >
              {shortAddress(campaign)}
            </a>
          </Field>
          {isContributor ? (
            <Field label="Your contribution">
              <span className="mono">{formatMon(summary.accountContribution)} MON</span>
              {summary.accountRefunded ? (
                <span className="ml-2 text-xs text-zinc-500">(refunded)</span>
              ) : null}
            </Field>
          ) : null}
        </dl>
      </header>

      <CampaignActions campaign={campaign} summary={summary} onDone={() => void refetch()} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-zinc-200">{children}</dd>
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      className={`rounded-xl border border-dashed p-8 text-center text-sm ${
        tone === "error" ? "border-red-500/30 text-red-300" : "border-zinc-800 text-zinc-500"
      }`}
    >
      {children}
    </div>
  );
}
