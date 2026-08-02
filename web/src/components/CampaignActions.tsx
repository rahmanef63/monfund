"use client";

import { useState } from "react";
import { parseEther, type Address } from "viem";
import { useAccount, useBalance } from "wagmi";
import { CHAIN_ID } from "@/lib/chain";
import { campaignAbi, CampaignState, type CampaignSummary } from "@/lib/contracts";
import { formatDuration, formatMon } from "@/lib/format";
import { useTxFlow } from "@/lib/useTxFlow";
import { useConnectModal } from "@/app/providers";
import { TxConfirmDialog } from "./TxConfirmDialog";

/**
 * Contribute / Withdraw / Refund.
 *
 * Which controls render is decided by the same rules the contract enforces —
 * the UI never offers an action the chain would reject, and the chain rejects
 * it anyway if someone gets around the UI.
 */
export function CampaignActions({
  campaign,
  summary,
  onDone,
}: {
  campaign: Address;
  summary: CampaignSummary;
  onDone: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { open } = useConnectModal();
  const flow = useTxFlow();
  const { data: balance } = useBalance({ address, chainId: CHAIN_ID, query: { enabled: !!address } });

  const [amount, setAmount] = useState("0.1");
  const [formError, setFormError] = useState<string | null>(null);

  const isCreator = !!address && address.toLowerCase() === summary.creator.toLowerCase();
  const goalMet = summary.totalRaised >= summary.goal;
  const expiredUnfunded = summary.state === CampaignState.Expired;
  const stillOpen = summary.timeRemaining > 0n;

  const canContribute = stillOpen && !summary.withdrawn;
  const canWithdraw = isCreator && goalMet && !summary.withdrawn;
  const canRefund =
    expiredUnfunded && summary.accountContribution > 0n && !summary.accountRefunded;

  function close() {
    const wasSuccess = flow.stage === "success";
    flow.reset();
    if (wasSuccess) onDone();
  }

  async function contribute() {
    setFormError(null);
    if (!isConnected) return open();

    let wei: bigint;
    try {
      wei = parseEther(amount || "0");
    } catch {
      return setFormError("Not a valid MON amount.");
    }
    if (wei <= 0n) return setFormError("Amount must be greater than zero.");
    if (balance && wei >= balance.value)
      return setFormError("That is your whole balance — leave some MON for gas.");

    const remaining = summary.goal > summary.totalRaised ? summary.goal - summary.totalRaised : 0n;

    await flow.prepare({
      label: "Contribute",
      address: campaign,
      abi: campaignAbi as never,
      functionName: "contribute",
      args: [],
      value: wei,
      details: [
        { label: "Raised so far", value: `${formatMon(summary.totalRaised)} MON` },
        { label: "Goal", value: `${formatMon(summary.goal)} MON` },
        {
          label: "Still needed",
          value: remaining > 0n ? `${formatMon(remaining)} MON` : "goal already met",
        },
        { label: "Time remaining", value: formatDuration(summary.timeRemaining) },
      ],
    });
  }

  async function withdraw() {
    setFormError(null);
    if (!isConnected) return open();
    await flow.prepare({
      label: "Withdraw raised funds",
      address: campaign,
      abi: campaignAbi as never,
      functionName: "withdraw",
      args: [],
      details: [
        { label: "You receive", value: `${formatMon(summary.totalRaised)} MON` },
        { label: "One time only", value: "the contract blocks a second withdrawal" },
      ],
    });
  }

  async function refund() {
    setFormError(null);
    if (!isConnected) return open();
    await flow.prepare({
      label: "Reclaim your contribution",
      address: campaign,
      abi: campaignAbi as never,
      functionName: "refund",
      args: [],
      details: [
        { label: "You reclaim", value: `${formatMon(summary.accountContribution)} MON` },
        { label: "One time only", value: "the contract blocks a second refund" },
      ],
    });
  }

  return (
    <>
      <div className="space-y-4">
        {canContribute ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-semibold">Contribute</h3>
            <p className="mt-1 text-xs text-zinc-500">
              {formatMon(summary.totalRaised)} of {formatMon(summary.goal)} MON raised ·{" "}
              {formatDuration(summary.timeRemaining)} left
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="mono w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
              />
              <button
                onClick={contribute}
                className="shrink-0 rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400"
              >
                {isConnected ? "Review" : "Connect"}
              </button>
            </div>
            {balance ? (
              <p className="mt-2 text-xs text-zinc-600">
                Balance: <span className="mono">{formatMon(balance.value)} MON</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {canWithdraw ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <h3 className="text-sm font-semibold text-emerald-200">
              Goal met — withdraw {formatMon(summary.totalRaised)} MON
            </h3>
            <p className="mt-1 text-xs text-emerald-200/60">
              Visible to you because this wallet is the campaign creator.
            </p>
            <button
              onClick={withdraw}
              className="mt-3 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
            >
              Review withdrawal
            </button>
          </div>
        ) : null}

        {canRefund ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <h3 className="text-sm font-semibold text-amber-200">
              Deadline passed, goal missed — reclaim {formatMon(summary.accountContribution)} MON
            </h3>
            <p className="mt-1 text-xs text-amber-200/60">
              You pull your own money back. Nothing is ever pushed to you automatically.
            </p>
            <button
              onClick={refund}
              className="mt-3 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-400"
            >
              Review refund
            </button>
          </div>
        ) : null}

        {summary.accountRefunded ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
            You have already reclaimed your contribution from this campaign.
          </p>
        ) : null}

        {summary.withdrawn ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
            The creator has withdrawn the raised funds. This campaign is closed.
          </p>
        ) : null}

        {!canContribute && !canWithdraw && !canRefund && !summary.withdrawn && !summary.accountRefunded ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
            {goalMet
              ? "Goal met — only the creator can withdraw."
              : "The deadline has passed. Only wallets that contributed can reclaim."}
          </p>
        ) : null}

        {formError ? <p className="text-sm text-red-300">{formError}</p> : null}
      </div>

      <TxConfirmDialog
        stage={flow.stage}
        preview={flow.preview}
        error={flow.error}
        txHash={flow.txHash}
        onConfirm={flow.confirmAndSend}
        onClose={close}
      />
    </>
  );
}
