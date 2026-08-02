"use client";

import Link from "next/link";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { CHAIN_ID, explorerAddress } from "@/lib/chain";
import { FACTORY_ADDRESS, isFactoryConfigured } from "@/lib/contracts";
import { formatMon, shortAddress } from "@/lib/format";
import { PARA_ENABLED, useConnectModal } from "@/app/providers";

export function SiteHeader() {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useConnectModal();
  const { data: balance } = useBalance({ address, chainId: CHAIN_ID, query: { enabled: !!address } });

  const wrongChain = isConnected && chainId !== undefined && chainId !== CHAIN_ID;

  return (
    <header className="border-b border-zinc-800">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">MonFund</span>
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
            Monad testnet
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {isConnected && balance ? (
            <span className="hidden text-sm text-zinc-400 sm:inline">
              {formatMon(balance.value)} MON
            </span>
          ) : null}

          {isConnected && address ? (
            <div className="flex items-center gap-2">
              <a
                href={explorerAddress(address)}
                target="_blank"
                rel="noreferrer"
                className="mono rounded-md border border-zinc-700 px-2.5 py-1.5 text-sm hover:border-zinc-500"
              >
                {shortAddress(address)}
              </a>
              <button
                onClick={() => disconnect()}
                className="rounded-md border border-zinc-800 px-2.5 py-1.5 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={open}
              className="rounded-md bg-violet-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-400"
            >
              Connect wallet
            </button>
          )}
        </div>
      </div>

      {wrongChain ? (
        <Banner tone="warn">
          Wrong network — switch your wallet to Monad testnet (chain id {CHAIN_ID}).
        </Banner>
      ) : null}

      {!isFactoryConfigured ? (
        <Banner tone="warn">
          <code className="mono">NEXT_PUBLIC_FACTORY_ADDRESS</code> is not set. Deploy the Factory
          through the Safe (<code className="mono">DEMO.md</code> §9), put the address in{" "}
          <code className="mono">web/.env.local</code> (<code className="mono">DEMO.md</code> §2),
          and restart the dev server.
        </Banner>
      ) : (
        <Banner tone="info">
          Factory:{" "}
          <a
            href={explorerAddress(FACTORY_ADDRESS!)}
            target="_blank"
            rel="noreferrer"
            className="mono underline underline-offset-2"
          >
            {FACTORY_ADDRESS}
          </a>
        </Banner>
      )}

      {!PARA_ENABLED ? (
        <Banner tone="muted">
          Para is not configured — falling back to an injected wallet (MetaMask). Set{" "}
          <code className="mono">NEXT_PUBLIC_PARA_API_KEY</code> in{" "}
          <code className="mono">web/.env.local</code> to enable email / passkey / social login.
        </Banner>
      ) : null}
    </header>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warn" | "info" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : tone === "info"
        ? "border-zinc-800 bg-zinc-900/60 text-zinc-400"
        : "border-zinc-800 bg-zinc-900/40 text-zinc-500";
  return (
    <div className={`border-t px-4 py-2 text-center text-xs ${cls}`}>
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}
