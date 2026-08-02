import { createPublicClient, http } from "viem";
import { monadTestnet } from "wagmi/chains";

/**
 * Monad testnet only. Chain id 10143.
 * `monadTestnet` comes straight from `wagmi/chains` — never hand-roll the chain object.
 */
export const CHAIN = monadTestnet;
export const CHAIN_ID = monadTestnet.id; // 10143

export const RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";

/**
 * Explorer used for every link this app renders.
 * wagmi's chain object points at monadexplorer; MonadVision is the one we surface.
 */
export const EXPLORER_BASE = "https://testnet.monadvision.com";

export const explorerTx = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const explorerAddress = (address: string) => `${EXPLORER_BASE}/address/${address}`;

/** Read-only client for simulation + gas estimation outside of React Query. */
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});
