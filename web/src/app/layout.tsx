import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "MonFund — crowdfunding on Monad testnet",
  description:
    "All-or-nothing fundraising in native MON on Monad testnet. Testnet only, not audited.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-8">{children}</main>
          <footer className="border-t border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
            Monad testnet (chain 10143) · native MON only · not audited, not for real funds
          </footer>
        </Providers>
      </body>
    </html>
  );
}
