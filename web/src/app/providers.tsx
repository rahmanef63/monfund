"use client";

import "@getpara/react-sdk/styles.css";

import { Environment, ParaProvider } from "@getpara/react-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createConfig, http, useConnect, WagmiProvider } from "wagmi";
import { monadTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { RPC_URL } from "@/lib/chain";

export const PARA_API_KEY = process.env.NEXT_PUBLIC_PARA_API_KEY?.trim() ?? "";
export const PARA_ENABLED = PARA_API_KEY.length > 0;

/* ------------------------------------------------------------------ *
 * Shared "open the connect UI" handle, so the header button doesn't
 * care whether Para or the injected-wallet fallback is active.
 * ------------------------------------------------------------------ */
const ConnectModalContext = createContext<{ open: () => void }>({ open: () => {} });
export const useConnectModal = () => useContext(ConnectModalContext);

export default function Providers({ children }: { children: ReactNode }) {
  return PARA_ENABLED ? (
    <ParaProviders>{children}</ParaProviders>
  ) : (
    <InjectedFallbackProviders>{children}</InjectedFallbackProviders>
  );
}

/* ------------------------------------------------------------------ *
 * Primary path — Para embedded MPC wallets (email / phone / passkey /
 * social) plus external-wallet connect. Monad wiring per the monskills
 * wallet-integration skill: chains + transports live inside
 * externalWalletConfig.evmConnector.config, and position 0 is the
 * default chain.
 * ------------------------------------------------------------------ */
function ParaProviders({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // Per-mount, never module scope: cache keys include the viewer address, and a
  // module-scope client would be shared across SSR requests for different viewers.
  const [queryClient] = useState(() => new QueryClient());
  const value = useMemo(() => ({ open: () => setIsOpen(true) }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{
          apiKey: PARA_API_KEY,
          env: Environment.BETA,
        }}
        config={{ appName: "MonFund" }}
        paraModalConfig={{
          isOpen,
          onClose: () => setIsOpen(false),
          oAuthMethods: ["GOOGLE", "APPLE", "DISCORD", "TWITTER", "FACEBOOK", "FARCASTER"],
          disablePhoneLogin: false,
          recoverySecretStepEnabled: true,
        }}
        externalWalletConfig={{
          evmConnector: {
            config: {
              // Testnet-only app: mainnet is deliberately not offered here.
              chains: [monadTestnet],
              transports: { [monadTestnet.id]: http(RPC_URL) },
            },
          },
          wallets: ["METAMASK", "COINBASE", "WALLETCONNECT", "RAINBOW", "ZERION", "RABBY"],
        }}
      >
        <ConnectModalContext.Provider value={value}>{children}</ConnectModalContext.Provider>
      </ParaProvider>
    </QueryClientProvider>
  );
}

/* ------------------------------------------------------------------ *
 * Fallback path — used ONLY when NEXT_PUBLIC_PARA_API_KEY is unset.
 * Para needs a real API key (`para login` + `para keys create`), which
 * only the project owner can mint. Rather than render a dead connect
 * button, fall back to a plain injected connector so the demo runs
 * out of the box. Set the Para key and this branch disappears.
 * ------------------------------------------------------------------ */
const injectedConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: { [monadTestnet.id]: http(RPC_URL) },
  ssr: true,
});

function InjectedFallbackProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={injectedConfig}>
      <QueryClientProvider client={queryClient}>
        <InjectedConnectBridge>{children}</InjectedConnectBridge>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function InjectedConnectBridge({ children }: { children: ReactNode }) {
  const { connect, connectors } = useConnect();
  const value = useMemo(
    () => ({ open: () => connect({ connector: connectors[0], chainId: monadTestnet.id }) }),
    [connect, connectors],
  );
  return <ConnectModalContext.Provider value={value}>{children}</ConnectModalContext.Provider>;
}
