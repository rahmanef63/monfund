"use client";

import { CampaignCard } from "@/components/CampaignCard";
import { CreateCampaignForm } from "@/components/CreateCampaignForm";
import { isFactoryConfigured } from "@/lib/contracts";
import { useCampaignList } from "@/lib/useCampaigns";

export default function Home() {
  const { campaigns, addresses, isLoading, error, refetch } = useCampaignList();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Crowdfund in MON</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          Create a campaign with a goal and a deadline. Anyone can chip in native MON. Hit the goal
          and the creator withdraws; miss it and every contributor pulls their own money back.
        </p>
      </section>

      <CreateCampaignForm onCreated={refetch} />

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">
            Campaigns{" "}
            <span className="text-sm font-normal text-zinc-500">
              {addresses.length > 0 ? `(${addresses.length})` : ""}
            </span>
          </h2>
          <button
            onClick={refetch}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
          >
            Refresh
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-600">
          Read directly from the Factory&apos;s onchain array — no indexer, no backend.
        </p>

        <div className="mt-4">
          {!isFactoryConfigured ? (
            <Empty>Set the Factory address to load campaigns.</Empty>
          ) : isLoading ? (
            <Empty>Loading campaigns…</Empty>
          ) : campaigns.length === 0 ? (
            error ? (
              <Empty tone="error">
                Could not read the Factory: {String(error.message ?? error)}
              </Empty>
            ) : (
              <Empty>No campaigns yet. Create the first one above.</Empty>
            )
          ) : (
            <>
              {/* A failed background poll is reported inline, never by destroying the
                  list — the last good read stays on screen. */}
              {error ? (
                <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
                  Could not refresh from the Factory — showing the last successful read.
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {campaigns.map((c) => (
                  <CampaignCard key={c.campaign} summary={c} />
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Empty({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      className={`rounded-xl border border-dashed p-8 text-center text-sm ${
        tone === "error" ? "border-red-500/30 text-red-300" : "border-zinc-800 text-zinc-500"
      }`}
    >
      {children}
    </div>
  );
}
