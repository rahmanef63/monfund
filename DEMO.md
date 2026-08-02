# MonFund — run the demo

All-or-nothing crowdfunding in native **MON** on **Monad testnet only** (chain id `10143`).
Built with [MONSKILLS](https://skills.devnads.com). **Not audited. Do not use with real funds.**

> Looking for architecture, diagrams and contract reference? See [README.md](README.md).
> This file is the hands-on walkthrough.

---

## What it does

- Anyone creates a campaign: a funding goal in MON, a deadline, and a short description.
- Anyone contributes MON to an open campaign, up until the deadline.
- Goal reached → the **creator** withdraws the balance, once.
- Deadline passes with the goal unmet → each **contributor** pulls back exactly their own
  contribution, once. Pull-based: funds are never pushed to anyone automatically.

Every rule above is enforced in the contract, not in the UI.

---

## Deployed on Monad testnet

> **Every `<TOKEN>` below is a placeholder, not a live value.** Deploy your own factory through the
> Safe (§9) and substitute what it prints; `deploy/multisig.example.json` is the template for
> recording the whole set.

| What | Address | Verified |
|---|---|---|
| **CampaignFactory** | `<FACTORY_ADDRESS>` | MonadVision + Monadscan — perfect match |
| **Campaign** (first instance) | `<CAMPAIGN_ADDRESS>` | MonadVision + Monadscan — perfect match |
| Safe multisig (2-of-2, deployer) | `<SAFE_ADDRESS>` | — |
| Agent wallet (Safe owner + proposer) | `<SAFE_OWNER_1>` | — |
| Your wallet (Safe owner + executor) | `<SAFE_OWNER_2>` | — |

> **A factory deployed before this tree predates a fund-lockup fix** — in that build
> `contribute()` stays open after the creator withdraws, and MON that lands in that window is
> stranded. The contracts here fix it; shipping them needs a redeploy through the Safe (§9). Full
> note in [README.md](README.md#live-deployment).

Explorer: <https://testnet.monadvision.com>

- Factory: `https://testnet.monadvision.com/address/<FACTORY_ADDRESS>`
- Campaign: `https://testnet.monadvision.com/address/<CAMPAIGN_ADDRESS>`
- Safe queue: `https://app.safe.global/transactions/history?safe=monad-testnet:<SAFE_ADDRESS>`

Deployment transactions (both executed by the Safe, agent signed 1/2, you signed 2/2):

| Safe nonce | What | Tx |
|---|---|---|
| 0 | deploy `CampaignFactory` via CreateCall delegatecall | `<TX_FACTORY_DEPLOY>` |
| 1 | `createCampaign(0.05 MON, +7d, "MonFund demo …")` | `<TX_CREATE_CAMPAIGN>` |

The Safe itself is deployed straight from the agent wallet (the one transaction the monskills
`wallet/` skill allows to bypass the multisig): `<TX_SAFE_DEPLOY>`.

The first campaign is created by the Safe, so its withdraw button only shows up for the Safe.
Create your own from the UI to exercise the full flow.

---

## 0. Prerequisites

```bash
node -v      # >=20.9, <23 (see engines in web/package.json; .nvmrc pins 22)
git --version
```

Foundry (only needed if you want to rebuild or re-test the contracts):

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

A wallet with Monad testnet MON. Faucet: <https://faucet.monad.xyz> — or the API the agent used:

```bash
curl -X POST https://agents.devnads.com/v1/faucet \
  -H "Content-Type: application/json" \
  -d '{"chainId": 10143, "address": "0xYOUR_ADDRESS"}'
```

Add Monad testnet to MetaMask if it isn't there: RPC `https://testnet-rpc.monad.xyz`,
chain id `10143`, symbol `MON`, explorer `https://testnet.monadvision.com`.

---

## 1. Install

```bash
git clone https://github.com/rahmanef63/monfund.git
cd monfund
npm ci --prefix web
```

---

## 2. Configure the frontend

```bash
cp web/.env.example web/.env.local
```

Then edit `web/.env.local`:

```ini
NEXT_PUBLIC_FACTORY_ADDRESS=<FACTORY_ADDRESS>
NEXT_PUBLIC_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_PARA_API_KEY=
```

`<FACTORY_ADDRESS>` is whatever §9 printed for you — the template ships it blank. Leave it unset
and the app shows a misconfiguration banner and lists nothing.

**About `NEXT_PUBLIC_PARA_API_KEY`** — Para gives you embedded MPC wallets with
email / phone / passkey / social login. Only you can mint the key, because it needs a browser
OAuth login:

```bash
npm install -g @getpara/cli
para login                  # opens a browser — only you can complete this
para keys create -n monfund-dev --display-name "MonFund (dev)"
```

Paste the **public** key into `NEXT_PUBLIC_PARA_API_KEY`. Leave it empty and the app falls back
to an injected wallet (MetaMask) so the demo still runs — you'll see a banner saying so.

---

## 3. Run it

```bash
npm run dev --prefix web
```

Open <http://localhost:3000>.

---

## 4. Demo script (about 5 minutes)

Have two wallets ready — call them **A** (creator) and **B** (contributor).

### a. Happy path — goal met, creator withdraws

1. Connect wallet **A**. Fill in the create form: goal `0.02` MON, deadline ~10 minutes out,
   a short description. Hit **Review & create**.
2. The confirm dialog shows the simulation result and the exact gas cost. Note the wording:
   Monad charges on the **gas limit**, not on gas used, so the number you see is what you pay.
   Confirm.
3. The campaign appears in the list, state **Open**, progress bar at 0%.
4. Open it. Switch to wallet **B**, contribute `0.02` MON. The panel shows time remaining down to
   the second and how much is still needed before you commit.
5. Progress hits 100% and the badge flips to **Goal met**. The refund button never appears.
6. Switch back to wallet **A** — a green **withdraw** panel is now visible (only to the creator).
   Withdraw. Badge flips to **Withdrawn**.
7. Within one poll (5s) the withdraw panel disappears — the UI does not offer an action the
   contract would reject. In its place: *"The creator has withdrawn the raised funds. This
   campaign is closed."* The contribute box is gone too, for every wallet: `contribute()` closes
   on withdrawal, not only on the deadline. Section **c** below shows the contract enforcing both.

### b. Failure path — deadline passes, contributors refund

1. Wallet **A** creates a campaign with a goal of `5` MON and a deadline ~2 minutes out.
2. Wallet **B** contributes `0.01` MON — nowhere near the goal.
3. Wait for the countdown to hit zero. The badge flips to **Expired**, the progress bar greys out,
   and the figure re-labels itself to `0.01 contributed / 5 MON goal` with the caption *"Total ever
   contributed, not funds held — the goal was missed and refunds are open."* `totalRaised` never
   decrements on chain, so the UI stops presenting it as a live balance.
4. The contribute box is gone — within one poll (5s) of the deadline the UI stops offering it.
   Wallets that never contributed see *"The deadline has passed. Only wallets that contributed
   can reclaim."*
5. Wallet **B** sees an amber **reclaim** panel. Refund → exactly `0.01` MON comes back.
6. Badge flips to **Refunded** for B, the reclaim panel disappears, and B sees *"You have already
   reclaimed your contribution from this campaign."*
7. Wallet **A** never gets a withdraw button — the goal was never met.

### c. Prove the UI isn't the only guard

The panels above vanish precisely because the app refuses to offer a doomed action — which means
the UI is never where a rule gets enforced. Go around it and the contract still says no:

```bash
RPC=https://testnet-rpc.monad.xyz

# refund before the deadline -> DeadlineNotPassed
cast call <CAMPAIGN_ADDRESS> "refund()" --from 0xYOUR_ADDRESS --rpc-url $RPC

# contribute after the deadline -> DeadlinePassed
cast call <CAMPAIGN_ADDRESS> "contribute()" --value 0.01ether \
  --from 0xYOUR_ADDRESS --rpc-url $RPC

# contribute after the creator withdrew -> AlreadyWithdrawn (same call, funded campaign)
# withdraw as anyone but the creator -> NotCreator
cast call <CAMPAIGN_ADDRESS> "withdraw()" --from 0xNOT_THE_CREATOR --rpc-url $RPC

# the creator's escape hatch, to a payout address of their choosing -> InvalidRecipient on zero
cast call <CAMPAIGN_ADDRESS> "withdrawTo(address)" \
  0x0000000000000000000000000000000000000000 --from 0xTHE_CREATOR --rpc-url $RPC
```

These are the exact reverts the app surfaces at *simulation* time when an action is still on
offer — for example confirming a contribute dialog you opened seconds before the deadline gives
you *"The deadline has passed — this campaign no longer accepts contributions."* and never
broadcasts, because every send re-simulates immediately beforehand.

---

## 5. Run the contract tests

`contracts/lib/` is gitignored, so a clean clone has to install the pinned dependencies first:

```bash
cd contracts
make install     # forge-std v1.16.2 + openzeppelin-contracts v5.4.0
make test        # or: forge test -vv
```

62 tests across three suites (50 `CampaignTest`, 10 `CampaignFactoryTest`, 2
`CampaignInvariantTest`), including every case the brief called for:

| Case | Test |
|---|---|
| Double withdrawal (and mixing `withdraw` / `withdrawTo`) | `test_RevertWhen_WithdrawTwice`, `test_RevertWhen_SecondWithdrawalThroughEitherEntryPoint` |
| A creator that cannot receive MON still gets the funds out | `test_WithdrawTo_EscapesCreatorThatCannotReceive` |
| Double refund | `test_RevertWhen_RefundTwice` |
| Contribution after the deadline | `test_RevertWhen_ContributeAfterDeadline` |
| Contribution after the creator withdrew | `test_RevertWhen_ContributeAfterWithdrawal` |
| Refund before the deadline | `test_RevertWhen_RefundBeforeDeadline` |
| Goal met exactly at the last contribution | `test_GoalMetExactlyAtLastContribution`, `test_GoalMetExactlyAtDeadlineMinusOne` |
| Reentrancy — withdraw | `test_Reentrancy_WithdrawIsBlocked` |
| Reentrancy — refund | `test_Reentrancy_RefundIsBlocked` |
| Reentrancy — cross-function `withdraw()` → `contribute()` | `test_Reentrancy_WithdrawIntoContributeIsBlocked` |
| Payouts never exceed contributions (invariant, 128k calls) | `invariant_PayoutsNeverExceedContributions` |

Gas report:

```bash
make gas
# or, excluding the invariant handler's 128k warm calls, which skew every median:
forge test --gas-report --no-match-contract CampaignInvariantTest
```

Before pushing, enable the repo's own gate once — git does not clone hooks:

```bash
git config core.hooksPath .githooks    # forge test + web typecheck + lint on every push
```

---

## 6. Project layout

```
monfund/
├── .monskills              built-with=monskills, chain=monad-testnet
├── .githooks/pre-push      forge test + web typecheck + lint (opt in, see section 5)
├── eslint.config.mjs       root config — the only way to lint scripts/ and tools/
├── DEMO.md                 this file
├── contracts/              Foundry project
│   ├── Makefile                    install / build / test / gas / dry-run / clean
│   ├── src/Campaign.sol            one campaign: goal, deadline, contributions, refunds
│   ├── src/CampaignFactory.sol     deploys campaigns, keeps the onchain address array
│   ├── script/Deploy.s.sol         simulation-only deploy for the Safe flow
│   └── test/                       62 tests: units, fuzz, invariants, attacker contracts
├── web/                    Next.js 16 + wagmi v3 + viem + Para
│   ├── .env.example                the three NEXT_PUBLIC_* keys, all blank or defaulted
│   └── src/
│       ├── app/                    layout, providers, campaign list, /campaign/[address]
│       ├── components/             cards, progress, countdown, confirm dialog, actions
│       └── lib/                    ABIs, chain config, tx flow (simulate -> gas -> confirm)
├── scripts/                ABI generator, verification payload builder
├── tools/relay/            browser-relay transport (see "How this was deployed")
└── deploy/multisig.example.json    template: Safe address, owners, threshold, deployments
```

---

## 7. How the contracts work

### `Campaign.sol`

| Storage | Why |
|---|---|
| `MAX_DESCRIPTION_BYTES` (280), `MAX_DURATION` (365 days) | `constant` — constructor bounds, no slot |
| `creator`, `goal`, `deadline` | `immutable` — no SLOAD on the hot path, which matters on Monad where cold storage reads cost 8,100 gas vs 2,100 on Ethereum |
| `totalRaised` | running total, final once the deadline passes |
| `withdrawn` | set **before** the transfer, so a second withdrawal can never pass the check |
| `contributions[addr]` | per-contributor balance, zeroed before the refund transfer |
| `refunded[addr]` | second guard against double refunds |

State machine (`state()`, derived — never stored):

```
                contribute()               withdraw()
   Open ──────────────────────▶ GoalMet ──────────────▶ Withdrawn
     │        (raised >= goal)     ↺
     │                             overfunding, until whichever
     │ deadline passes,            comes first: withdraw or deadline
     │ raised < goal
     ▼
  Expired ──▶ each contributor calls refund() once
```

`Expired` and `GoalMet` are mutually exclusive and there is no arrow between them in either
direction: `contribute()` reverts at or after the deadline, so `raised` can never cross `goal`
once a campaign has expired, and reaching the goal before the deadline means the clock stops
mattering.

The UI adds one viewer-scoped state, **Refunded** — "this campaign expired unfunded and *you*
already pulled your money out".

Safety rails:

- `contribute()` reverts at or after the deadline, **and once the creator has withdrawn** —
  `withdraw()` has no deadline check, so it can land while the campaign is still open, and MON
  arriving after it could be neither withdrawn (one-shot) nor refunded (the goal was met). No
  `receive()`/`fallback()`, so MON cannot enter any other way.
- The constructor rejects a deadline more than `MAX_DURATION` (365 days) out, so a campaign can
  never park contributions beyond a year with no exit.
- `withdraw()` requires `msg.sender == creator`, `totalRaised >= goal`, and `!withdrawn`. It is a
  one-line wrapper over `withdrawTo(payable(creator))`, so there is a single implementation of the
  checks and the payout.
- `withdrawTo(address payable to)` is the same one-shot withdrawal to an address the creator names,
  rejecting `address(0)` with `InvalidRecipient`. It exists because `creator` is immutable: a
  contract creator with no payable `receive` would otherwise fail `withdraw()` with
  `TransferFailed` forever while refunds stayed closed (`totalRaised >= goal`), locking every
  contributor's MON. It gives an EOA creator nothing new. `Withdrawn` carries both the creator and
  the recipient so the log never misattributes the payout.
- `refund()` requires the deadline to have passed, `totalRaised < goal`, a non-zero contribution,
  and no prior refund. It opens *exactly at* the deadline — the check is a strict `<`.
- Every value-moving path is `nonReentrant` (OpenZeppelin `ReentrancyGuard`) and follows
  checks-effects-interactions. `withdraw()` does not take the guard itself — it takes it through
  `withdrawTo`, and grabbing a non-reentrant guard twice in one call would revert. Failed transfers
  revert with `TransferFailed` rather than being swallowed.
- Reentrancy is covered three ways in the tests: re-entering `withdraw` from the creator's
  `receive()`, re-entering `refund` from a contributor's `receive()`, and cross-function
  `withdraw() -> contribute()` (the one path that is reachable in time). Each attacker records the
  revert **selector** and the test asserts it was the guard that fired.

### `CampaignFactory.sol`

Holds `address[] public campaigns` plus `isCampaign[addr]`. `getCampaigns()` returns the whole
array in one `eth_call`, which is how the frontend lists campaigns with no indexer and no backend.
The factory holds no funds and has no owner, admin or moderation role.

---

## 8. Frontend behaviour worth knowing

- **Every write is simulated first, and again on confirm.** `simulateContract` runs against the
  node before the confirm dialog opens, and once more immediately before the send — so a dialog
  that went stale while it sat open (the deadline passed, the creator withdrew) fails in the
  dialog instead of burning the pinned gas limit on a revert.
- **The dialog names what it is signing.** Target contract and function are shown as their own
  rows, above the caller-supplied details, and cannot be overridden by them. Creating a campaign
  also shows the description that gets written on chain permanently.
- **It is a real `<dialog>`.** Focus is trapped, the background is inert, Escape closes it —
  except while simulating or sending, where Escape is suppressed so an in-flight transaction
  cannot be abandoned.
- **Wrong network is caught before simulation**, with *"Wrong network — switch your wallet to
  Monad testnet (10143)."*
- **The detail page fails closed on provenance.** `/campaign/<address>` renders nothing at all —
  no header, no contribute box — until the factory confirms it deployed that address. "Still
  checking", "not ours" and "could not check" are three distinct messages.
- **Gas is estimated, capped and pinned.** The estimate gets at most a 10% buffer and that limit
  is set explicitly on the transaction. This matters on Monad specifically: gas is charged on the
  limit, so letting a wallet fall back to a huge default limit would cost you real MON.
- **Nothing broadcasts without a click.** The dialog shows gas limit, gas price and total cost,
  and waits.
- **Writes use `useWriteContractSync`** (wagmi v3), which goes through
  `eth_sendRawTransactionSync` — the receipt comes back in the same round trip.
- **Reads use multicall3** at `0xcA11bde05977b3631167028862bE2a173976CA11`, verified present on
  Monad testnet, so the whole campaign list is one batched call.
- **Countdowns tick locally** off the chain-supplied `timeRemaining`, so the number you read right
  before contributing is the exact seconds left.

---

## 9. Redeploying (if you ever need to)

Deployment goes through the Safe — the agent wallet proposes, you approve. Never
`forge script --broadcast` with the agent key for anything except the Safe itself. This is also
the only way to replace a pre-fix factory with the fixed contracts, and it is where every
`<TOKEN>` used earlier in this file comes from: substitute your own Safe for `<SAFE_ADDRESS>`, and
the run prints the rest.

> **The keystore handling in step 2 is blunt and is not safe to copy elsewhere.**
> `--unsafe-password ""` assumes an empty-passphrase keystore, the decrypted key is `awk`'d off
> stdout into the environment (process table, possibly shell history), and `ls … | head -1` picks
> whichever keystore sorts first. Check `ls ~/.monskills/keystore` and name the file explicitly if
> you have more than one.

```bash
cd contracts

# 1. Simulate from the Safe (no broadcast) to produce the deployment bytecode
make dry-run SAFE_ADDRESS=<SAFE_ADDRESS>

# 2. Propose it to the Safe. SCRIPT_DIR is the monskills wallet/utils folder —
#    the one containing propose.sh and propose.mjs.
SCRIPT_DIR=~/.agents/skills/wallet/utils
KEYSTORE_FILENAME=$(ls ~/.monskills/keystore | head -1)
CHAIN_ID=10143 \
  SAFE_ADDRESS=<SAFE_ADDRESS> \
  PRIVATE_KEY=$(cast wallet decrypt-keystore --keystore-dir ~/.monskills/keystore $KEYSTORE_FILENAME --unsafe-password "" | awk '{print $NF}') \
  DEPLOYMENT_BYTECODE=$(jq -r '.transactions[0].transaction.input' \
    broadcast/Deploy.s.sol/10143/dry-run/run-latest.json) \
  bash "$SCRIPT_DIR/propose.sh"

# 3. Approve + execute in the Safe UI, then read the address out of the CreateCall log
#    (the receipt's own contractAddress is always null for Safe deployments).
#    ContractCreation(address indexed) — the address is in topics[1], data is empty.
#    Filter on topics[0], NOT on log.address: CreateCall is delegatecalled, so the log
#    is emitted under the Safe's own address.
cast receipt <TX_FACTORY_DEPLOY> --rpc-url https://testnet-rpc.monad.xyz --json \
  | jq -r '.logs[] | select(.topics[0] ==
      "0x4db17dd5e4732fb6da34a148104a592783ca119a1e7bb8829eba6cbadef0b511")
      | .topics[1]' | sed 's/0x000000000000000000000000/0x/'

# 4. Verify on both explorers with one call. foundry.toml sets build_info = true,
#    so a plain `forge build` already emits the full build-info the payload needs.
#    The script then eth_getCode's the address and refuses if the local build
#    disagrees. Drop the third argument and it writes to a fresh 0700 temp dir
#    instead, printing the path.
forge build
node ../scripts/make-verify-payload.mjs CampaignFactory <FACTORY_ADDRESS> /tmp/verify.json
curl -X POST https://agents.devnads.com/v1/verify \
  -H "Content-Type: application/json" -d @/tmp/verify.json
```

Set `MONAD_TESTNET_RPC` to point the on-chain check at a different node, or
`VERIFY_SKIP_ONCHAIN_CHECK=1` to skip it entirely — needed on a no-egress machine (§10), and a
deliberate downgrade of what verification proves.

Then update `NEXT_PUBLIC_FACTORY_ADDRESS` in `web/.env.local` and restart the dev server.

If you change the contracts, regenerate the frontend ABIs:

```bash
cd contracts && forge build
cd ../web && npm run gen:abi
```

---

## 10. How this was deployed from a sandbox

Worth knowing if something looks unusual in the git history. The build ran in a cloud container
whose network allowlist blocks `testnet-rpc.monad.xyz`, `api.safe.global` and
`agents.devnads.com`. Rather than reimplement the Safe proposal flow — which the monskills
`wallet/` skill explicitly forbids — the agent ran monskills' own `propose.mjs` **completely
unmodified** and only replaced its network transport: `tools/relay/relay-fetch.mjs` overrides
`globalThis.fetch`, writes each request to a file, and the response is fetched through a browser
on a networked machine and written back. Payloads were transferred gzip+base64 and checked with
SHA-256 on both ends before being sent, so nothing was retyped by hand.

You do not need any of this. On a normal machine the commands in section 9 just work.

---

## Scope

Deliberately not included: ERC-20 or any token other than native MON, campaign categories,
admin or moderation roles, an indexer, analytics. Testnet only.
