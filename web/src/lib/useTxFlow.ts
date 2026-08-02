"use client";

import { useCallback, useState } from "react";
import type { Abi, Address } from "viem";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { useAccount, useWriteContractSync } from "wagmi";
import { CHAIN_ID, publicClient } from "./chain";

export type TxRequest = {
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  /** Extra human-readable lines shown in the confirm dialog. */
  details?: { label: string; value: string }[];
};

export type TxPreview = {
  request: TxRequest;
  /** Gas limit we will actually put on the transaction. */
  gasLimit: bigint;
  /** Raw estimate before the buffer, for transparency. */
  gasEstimate: bigint;
  gasPrice: bigint;
  /** gasLimit * gasPrice — on Monad you pay the LIMIT, not the used gas. */
  gasCostWei: bigint;
};

export type TxStage = "idle" | "simulating" | "ready" | "sending" | "success" | "error";

/**
 * Every write in this app goes through here:
 *
 *   simulate  ->  estimate gas  ->  show cost  ->  WAIT for an explicit click  ->  send
 *
 * Nothing is broadcast without the user pressing Confirm on a dialog that already
 * shows the simulated outcome and the exact gas cost.
 *
 * Monad charges on the gas LIMIT, not on gas used, so we estimate against the real
 * node, add at most a 10% buffer, and pin that limit on the transaction rather than
 * letting the wallet guess (a wallet that falls back to a huge default limit would
 * cost the user real MON here).
 */
export function useTxFlow() {
  const { address: account, chainId } = useAccount();
  const { writeContractSyncAsync } = useWriteContractSync();

  const [stage, setStage] = useState<TxStage>("idle");
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setPreview(null);
    setError(null);
    setTxHash(null);
  }, []);

  /** Step 1: simulate + price. Never sends anything. */
  const prepare = useCallback(
    async (request: TxRequest) => {
      if (!account) {
        setError("Connect a wallet first.");
        setStage("error");
        return;
      }
      // `publicClient` is pinned to testnet, so a wallet on another chain would get a
      // green "simulation succeeded" for a transaction it can never send. Say so up
      // front instead of failing with a ChainMismatchError after the user confirms.
      if (chainId !== undefined && chainId !== CHAIN_ID) {
        setError(`Wrong network — switch your wallet to Monad testnet (${CHAIN_ID}).`);
        setStage("error");
        return;
      }

      setStage("simulating");
      setError(null);
      setTxHash(null);
      setPreview(null);

      try {
        // 1. Simulate — this is what catches "deadline passed", "already refunded",
        //    "not the creator", etc. before the user ever pays for gas.
        await publicClient.simulateContract({
          account,
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args as never,
          value: request.value,
        });

        // 2. Estimate against the real node, then add a small buffer.
        const gasEstimate = await publicClient.estimateContractGas({
          account,
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args as never,
          value: request.value,
        });
        const gasLimit = gasEstimate + gasEstimate / 10n; // 10% buffer, the max the gas skill allows

        const gasPrice = await publicClient.getGasPrice();

        setPreview({
          request,
          gasEstimate,
          gasLimit,
          gasPrice,
          gasCostWei: gasLimit * gasPrice,
        });
        setStage("ready");
      } catch (e) {
        setError(describeError(e));
        setStage("error");
      }
    },
    [account, chainId],
  );

  /** Step 2: only runs after the user clicks Confirm on the dialog. */
  const confirmAndSend = useCallback(async () => {
    if (!preview) return;
    setStage("sending");
    setError(null);

    try {
      const { request, gasLimit } = preview;

      // Re-simulate against current state. The preview is a snapshot: the deadline
      // may have passed, or someone may have withdrawn, while the dialog sat open.
      // Monad charges on the gas LIMIT, so sending a doomed tx with a pinned limit
      // burns the whole limit on a revert — exactly what this flow exists to prevent.
      await publicClient.simulateContract({
        account,
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args as never,
        value: request.value,
      });

      // useWriteContractSync -> eth_sendRawTransactionSync: receipt comes back in the
      // same round trip, which is what makes the UI feel instant on Monad.
      const result = await writeContractSyncAsync({
        chainId: CHAIN_ID,
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args as never,
        value: request.value,
        gas: gasLimit,
      });

      const hash =
        typeof result === "string"
          ? (result as `0x${string}`)
          : ((result as { transactionHash?: `0x${string}` })?.transactionHash ?? null);

      setTxHash(hash);
      setStage("success");
    } catch (e) {
      setError(describeError(e));
      setStage("error");
    }
  }, [account, preview, writeContractSyncAsync]);

  return { stage, preview, error, txHash, prepare, confirmAndSend, reset, account };
}

const FRIENDLY: Record<string, string> = {
  DeadlinePassed: "The deadline has passed — this campaign no longer accepts contributions.",
  ZeroContribution: "Enter an amount greater than zero.",
  NotCreator: "Only the campaign creator can withdraw.",
  GoalNotMet: "The goal has not been reached, so there is nothing to withdraw.",
  AlreadyWithdrawn: "The creator has already withdrawn these funds.",
  DeadlineNotPassed: "Refunds only open after the deadline.",
  GoalWasMet: "The goal was reached, so contributions are not refundable.",
  NothingToRefund: "This wallet has no contribution to reclaim.",
  AlreadyRefunded: "This wallet has already been refunded.",
  TransferFailed: "The MON transfer failed — the receiving address rejected it.",
  InvalidGoal: "The goal must be greater than zero.",
  InvalidCreator: "The campaign creator address is invalid.",
  InvalidRecipient: "Pick a real recipient address — the zero address would burn the raise.",
  // Inherited from OpenZeppelin's ReentrancyGuard, so it is in the ABI and decodable
  // even though no MonFund .sol declares it.
  ReentrancyGuardReentrantCall: "That call re-entered the campaign and was blocked.",
  BadRange: "That page of campaigns is out of range.",
  DeadlineInPast: "Pick a deadline in the future.",
  DeadlineTooFar: "Pick a deadline no more than a year out.",
  DescriptionEmpty: "Add a short description.",
  DescriptionTooLong: "Description must be 280 characters or fewer.",
};

export function describeError(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && FRIENDLY[name]) return FRIENDLY[name];
      if (name) return `Reverted: ${name}`;
      if (reverted.reason) return reverted.reason;
    }
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
