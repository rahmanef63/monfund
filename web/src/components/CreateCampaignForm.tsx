"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount } from "wagmi";
import { campaignFactoryAbi, FACTORY_ADDRESS } from "@/lib/contracts";
import { formatDeadline } from "@/lib/format";
import { useTxFlow } from "@/lib/useTxFlow";
import { useConnectModal } from "@/app/providers";
import { TxConfirmDialog } from "./TxConfirmDialog";

const MAX_DESCRIPTION = 280;
/** Mirrors `Campaign.MAX_DURATION` — the constructor reverts `DeadlineTooFar` past this. */
const MAX_DURATION_SECONDS = 365 * 86_400;

/** `datetime-local` wants wall-clock time in the user's zone, not an ISO/UTC string. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDeadline() {
  return toLocalInput(new Date(Date.now() + 7 * 86_400_000));
}

export function CreateCampaignForm({ onCreated }: { onCreated?: () => void }) {
  const { isConnected } = useAccount();
  const { open } = useConnectModal();
  const flow = useTxFlow();

  const [goal, setGoal] = useState("1");
  const [deadline, setDeadline] = useState(defaultDeadline);
  // Lazy initialiser, like `deadline` above: computing this during render would give
  // the server and the client two different clocks and desync hydration.
  const [maxDeadlineInput] = useState(() =>
    toLocalInput(new Date(Date.now() + MAX_DURATION_SECONDS * 1000)),
  );
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const deadlineUnix = deadline ? Math.floor(new Date(deadline).getTime() / 1000) : 0;

  function validate(): string | null {
    let goalWei: bigint;
    try {
      goalWei = parseEther(goal || "0");
    } catch {
      return "Goal is not a valid MON amount.";
    }
    if (goalWei <= 0n) return "Goal must be greater than zero.";
    if (!deadlineUnix) return "Pick a deadline.";
    if (deadlineUnix <= Math.floor(Date.now() / 1000) + 60)
      return "Pick a deadline at least a minute in the future.";
    if (deadlineUnix > Math.floor(Date.now() / 1000) + MAX_DURATION_SECONDS)
      return "Pick a deadline no more than a year out.";
    const bytes = new TextEncoder().encode(description).length;
    if (bytes === 0) return "Add a short description.";
    if (bytes > MAX_DESCRIPTION) return `Description must be ${MAX_DESCRIPTION} bytes or fewer.`;
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!isConnected) return open();
    if (!FACTORY_ADDRESS) return setFormError("Factory address is not configured.");

    const problem = validate();
    if (problem) return setFormError(problem);

    await flow.prepare({
      label: "Create campaign",
      address: FACTORY_ADDRESS,
      abi: campaignFactoryAbi as never,
      functionName: "createCampaign",
      args: [parseEther(goal), BigInt(deadlineUnix), description],
      details: [
        { label: "Goal", value: `${goal} MON` },
        { label: "Deadline", value: formatDeadline(BigInt(deadlineUnix)) },
        // This string is written to the chain permanently and cannot be edited
        // afterwards, so show it verbatim on the last screen before signing.
        { label: "Description (permanent)", value: description },
      ],
    });
  }

  function close() {
    const wasSuccess = flow.stage === "success";
    flow.reset();
    if (wasSuccess) {
      setDescription("");
      onCreated?.();
    }
  }

  const bytesUsed = new TextEncoder().encode(description).length;

  return (
    <>
      <form
        onSubmit={submit}
        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
      >
        <h2 className="text-base font-semibold">Start a campaign</h2>
        <p className="mt-1 text-xs text-zinc-500">
          All-or-nothing. If the goal is not reached by the deadline, everyone can take their MON
          back.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-zinc-400">Funding goal (MON)</span>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              inputMode="decimal"
              placeholder="1.0"
              className="mono mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
            />
          </label>

          <label className="block">
            <span className="text-xs text-zinc-400">Deadline</span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              max={maxDeadlineInput}
              className="mono mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="flex items-baseline justify-between text-xs text-zinc-400">
            <span>Short description</span>
            <span className={bytesUsed > MAX_DESCRIPTION ? "text-red-400" : "text-zinc-600"}>
              {bytesUsed}/{MAX_DESCRIPTION}
            </span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What are you raising for?"
            className="mt-1 w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
        </label>

        {formError ? <p className="mt-3 text-sm text-red-300">{formError}</p> : null}

        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 sm:w-auto"
        >
          {isConnected ? "Review & create" : "Connect wallet"}
        </button>
      </form>

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
