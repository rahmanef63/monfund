"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { zeroAddress } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { CHAIN_ID } from "./chain";
import {
  type CampaignSummary,
  campaignAbi,
  campaignFactoryAbi,
  FACTORY_ADDRESS,
} from "./contracts";

/**
 * Campaign list, read straight from the Factory's onchain array — no indexer.
 * One eth_call for the address array, then one multicall3 batch for every summary.
 */
export function useCampaignList() {
  const { address } = useAccount();
  const viewer = address ?? zeroAddress;

  const addressesQuery = useReadContract({
    chainId: CHAIN_ID,
    address: FACTORY_ADDRESS,
    abi: campaignFactoryAbi,
    functionName: "getCampaigns",
    query: { enabled: Boolean(FACTORY_ADDRESS), refetchInterval: 10_000 },
  });

  const addresses = useMemo(
    () => (addressesQuery.data as Address[] | undefined) ?? [],
    [addressesQuery.data],
  );

  const summariesQuery = useReadContracts({
    contracts: addresses.map((a) => ({
      chainId: CHAIN_ID,
      address: a,
      abi: campaignAbi,
      functionName: "summary" as const,
      args: [viewer] as const,
    })),
    query: { enabled: addresses.length > 0, refetchInterval: 10_000 },
  });

  const campaigns = useMemo(() => {
    const rows = summariesQuery.data ?? [];
    return rows
      .map((r) => (r.status === "success" ? (r.result as unknown as CampaignSummary) : null))
      // Everything downstream links and labels off `summary.campaign`, which is
      // contract-supplied. Keep a row only if it agrees with the Factory-attested
      // address at the same index, so that field can be trusted as identity.
      .filter(
        (r, i): r is CampaignSummary =>
          r !== null && r.campaign.toLowerCase() === addresses[i]?.toLowerCase(),
      )
      .slice()
      .reverse(); // newest first
  }, [summariesQuery.data, addresses]);

  return {
    campaigns,
    addresses,
    isLoading: addressesQuery.isLoading || (addresses.length > 0 && summariesQuery.isLoading),
    error: addressesQuery.error ?? summariesQuery.error ?? null,
    refetch: () => {
      void addressesQuery.refetch();
      void summariesQuery.refetch();
    },
  };
}

/** Single campaign, refreshed often enough that the countdown and bar stay honest. */
export function useCampaign(campaign?: Address) {
  const { address } = useAccount();
  const viewer = address ?? zeroAddress;

  const query = useReadContract({
    chainId: CHAIN_ID,
    address: campaign,
    abi: campaignAbi,
    functionName: "summary",
    args: [viewer],
    query: { enabled: Boolean(campaign), refetchInterval: 5_000 },
  });

  return {
    summary: query.data as unknown as CampaignSummary | undefined,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Confirms an address really came out of our Factory before we render it as a campaign.
 *
 * `isKnown` is deliberately tri-state: `true` only when the Factory affirmatively
 * says yes. `undefined` means the question was never answered — the query is
 * disabled (no Factory configured), still in flight, or the eth_call failed — and
 * callers must treat that as "unverified", never as "fine". `error` is surfaced so a
 * failing RPC cannot masquerade as a clean negative.
 */
export function useIsKnownCampaign(campaign?: Address) {
  const query = useReadContract({
    chainId: CHAIN_ID,
    address: FACTORY_ADDRESS,
    abi: campaignFactoryAbi,
    functionName: "isCampaign",
    args: campaign ? [campaign] : undefined,
    query: { enabled: Boolean(FACTORY_ADDRESS && campaign) },
  });
  return {
    isKnown: query.data as boolean | undefined,
    isLoading: query.isLoading,
    error: query.error,
  };
}
