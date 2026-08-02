"use client";

import { useEffect, useRef } from "react";
import { explorerTx } from "@/lib/chain";
import { formatMon } from "@/lib/format";
import type { TxStage, TxPreview } from "@/lib/useTxFlow";

/**
 * The single confirmation surface for every write in the app.
 *
 * It only appears once the transaction has already been simulated against the
 * node, and it always shows the target contract, the function, the gas limit that
 * will be pinned on the tx and the MON that limit costs — because on Monad you pay
 * for the limit, not for the gas actually used. Nothing is broadcast until Confirm
 * is clicked.
 *
 * It is a native <dialog> opened with showModal(), which is what gives us the focus
 * trap, the inert background and Escape handling that a plain overlay div never had.
 */
export function TxConfirmDialog({
  stage,
  preview,
  error,
  txHash,
  onConfirm,
  onClose,
}: {
  stage: TxStage;
  preview: TxPreview | null;
  error: string | null;
  txHash: `0x${string}` | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const isOpen = stage !== "idle";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isOpen && !el.open) el.showModal();
    else if (!isOpen && el.open) el.close();
  }, [isOpen]);

  return (
    <dialog
      ref={ref}
      aria-label="Transaction confirmation"
      onCancel={(e) => {
        // Escape must not abandon a dialog whose transaction is already in flight.
        if (stage === "simulating" || stage === "sending") e.preventDefault();
        else onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl backdrop:bg-black/70"
    >
      <div>
        {stage === "simulating" ? (
          <Body title="Simulating…">
            <p className="text-sm text-zinc-400">
              Running the call against the node before anything is signed.
            </p>
          </Body>
        ) : null}

        {stage === "ready" && preview ? (
          <Body title={`Confirm: ${preview.request.label}`}>
            <p className="text-sm text-emerald-300">
              Simulation succeeded — this transaction should not revert.
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              {/* Target and function come straight off the request and cannot be
                  overridden by a caller's free-text `details`. For Para embedded
                  wallets this dialog is the only place they are ever shown. */}
              <Row label="Contract" value={preview.request.address} />
              <Row label="Function" value={preview.request.functionName} />
              {preview.request.details?.map((d) => (
                <Row key={d.label} label={d.label} value={d.value} />
              ))}
              {preview.request.value !== undefined && preview.request.value > 0n ? (
                <Row label="Amount" value={`${formatMon(preview.request.value)} MON`} strong />
              ) : null}
              <div className="!mt-3 border-t border-zinc-800 pt-3" />
              <Row label="Gas estimate" value={`${preview.gasEstimate.toString()} gas`} />
              <Row
                label="Gas limit on tx"
                value={`${preview.gasLimit.toString()} gas (+10%)`}
              />
              <Row
                label="Gas price"
                value={`${(Number(preview.gasPrice) / 1e9).toFixed(2)} gwei`}
              />
              <Row
                label="Max gas cost"
                value={`${formatMon(preview.gasCostWei, 6)} MON`}
                strong
              />
            </dl>

            <p className="mt-3 text-xs text-zinc-500">
              Monad charges on the gas limit, not on gas used — this is what you will pay for gas.
            </p>

            <Actions>
              <button
                onClick={onClose}
                className="rounded-md border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 hover:border-zinc-500"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="rounded-md bg-violet-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-400"
              >
                Confirm &amp; send
              </button>
            </Actions>
          </Body>
        ) : null}

        {stage === "sending" ? (
          <Body title="Sending…">
            <p className="text-sm text-zinc-400">Waiting for the transaction receipt.</p>
          </Body>
        ) : null}

        {stage === "success" ? (
          <Body title="Done">
            <p className="text-sm text-emerald-300">Transaction confirmed.</p>
            {txHash ? (
              <a
                href={explorerTx(txHash)}
                target="_blank"
                rel="noreferrer"
                className="mono mt-3 block break-all text-xs text-violet-300 underline underline-offset-2"
              >
                {txHash}
              </a>
            ) : null}
            <Actions>
              <button
                onClick={onClose}
                className="rounded-md bg-zinc-800 px-3.5 py-2 text-sm hover:bg-zinc-700"
              >
                Close
              </button>
            </Actions>
          </Body>
        ) : null}

        {stage === "error" ? (
          <Body title="Blocked">
            <p className="text-sm text-red-300">{error}</p>
            <Actions>
              <button
                onClick={onClose}
                className="rounded-md bg-zinc-800 px-3.5 py-2 text-sm hover:bg-zinc-700"
              >
                Close
              </button>
            </Actions>
          </Body>
        ) : null}
      </div>
    </dialog>
  );
}

function Body({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className={`mono break-all text-right ${strong ? "text-zinc-100" : "text-zinc-300"}`}>
        {value}
      </dd>
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex justify-end gap-2">{children}</div>;
}
