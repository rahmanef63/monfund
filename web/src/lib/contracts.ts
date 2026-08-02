import type { Address } from "viem";
import { campaignAbi, campaignFactoryAbi } from "./abis";

export { campaignAbi, campaignFactoryAbi };

const raw = process.env.NEXT_PUBLIC_FACTORY_ADDRESS?.trim();

/** Set by the Safe-multisig deployment (DEMO.md §9); configured in web/.env.local (DEMO.md §2). */
export const FACTORY_ADDRESS = (raw && /^0x[0-9a-fA-F]{40}$/.test(raw)
  ? (raw as Address)
  : undefined);

export const isFactoryConfigured = FACTORY_ADDRESS !== undefined;

/** Mirrors Campaign.State in the Solidity source. */
export enum CampaignState {
  Open = 0,
  GoalMet = 1,
  Withdrawn = 2,
  Expired = 3,
}

export type CampaignSummary = {
  campaign: Address;
  creator: Address;
  goal: bigint;
  deadline: bigint;
  totalRaised: bigint;
  withdrawn: boolean;
  state: number;
  timeRemaining: bigint;
  progressBps: bigint;
  description: string;
  accountContribution: bigint;
  accountRefunded: boolean;
};

/**
 * The five states the UI shows. `Refunded` is per-viewer, not a contract state —
 * it means "this campaign expired unfunded and you have already pulled your money".
 */
export type DisplayState = "open" | "goalMet" | "expired" | "withdrawn" | "refunded";

export function displayState(s: CampaignSummary, viewerIsContributor: boolean): DisplayState {
  if (s.state === CampaignState.Withdrawn) return "withdrawn";
  if (s.state === CampaignState.GoalMet) return "goalMet";
  if (s.state === CampaignState.Expired) {
    if (viewerIsContributor && s.accountRefunded) return "refunded";
    return "expired";
  }
  return "open";
}

export const STATE_META: Record<DisplayState, { label: string; className: string; hint: string }> = {
  open: {
    label: "Open",
    className: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    hint: "Accepting contributions until the deadline.",
  },
  goalMet: {
    label: "Goal met",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    hint: "Goal reached — the creator can withdraw. No refunds.",
  },
  expired: {
    label: "Expired",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    hint: "Deadline passed without reaching the goal — contributors can reclaim.",
  },
  withdrawn: {
    label: "Withdrawn",
    className: "border-violet-400/30 bg-violet-400/10 text-violet-300",
    hint: "The creator has withdrawn the raised funds.",
  },
  refunded: {
    label: "Refunded",
    className: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300",
    hint: "You have already reclaimed your contribution.",
  },
};
