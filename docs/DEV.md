# MapSocial — Developer Document

> Status: v0.2 (EVM MVP implemented)
> Phase: free indefinitely until the user base hits target, then revisit monetization (no 90-day countdown).

## 1. Product Overview

A wallet-based social network whose main interface is a minimalist zoomable map:

- EVM wallet login via SIWE signature (zero gas, read-only public key)
- Create a Profile (avatar / gender / username / bio / links / permission toggles / blocklist)
- The map shows visible users; click an avatar to view a Profile and send a DM
- A trust score is computed uniformly from multi-chain on-chain data → determines the daily approach (initiated-DM) quota
- Referral: invite a friend who completes their Profile → both sides earn extra approach quota (no cash payouts during the free phase)
- i18n: dictionaries for 9 languages live in `src/lib/locales/`; `src/lib/i18n.tsx` provides the Provider/useI18n; API errors return a `code` field that the client localizes
- VPN detection: `src/lib/ipcheck.ts` detects proxy/hosting IPs via IP intelligence (ip-api.com by default, swappable via `IP_CHECK_URL`), refreshed every 24h; `users.vpn_detected` is surfaced as a badge on the Profile card
- Future: an Open API for wallets and other products to build on; after monetization, referral upgrades to net-revenue sharing

## 2. Multi-chain Architecture (unified EVM identity)

The same mnemonic derives the same address on every EVM chain, so **one signature = identity across all chains**.

| Chain | Chain ID | trustWeight | Data source |
|---|---|---|---|
| Ethereum | 1 | 1.0 | Public RPC |
| Polygon | 137 | 0.8 | Public RPC |
| Arbitrum One | 42161 | 0.8 | Public RPC |
| Robinhood Chain | 4663 | 0.5 | rpc.mainnet.chain.robinhood.com |
| HyperEVM | 999 | 0.5 | rpc.hyperliquid.xyz/evm |

Design principles:

- New chains (Robinhood/HyperEVM) get low weights to stop score farming via cheap activity on zero-cost new chains
- Adding a chain = adding one entry to `APP_CHAINS` in `src/lib/chains.ts`
- Non-EVM chains (Solana etc.) will be onboarded later via "multi-address signature binding" (one user, multiple addresses); not implemented yet
- HyperEVM only reads EVM-side balances; HyperCore (trading layer) assets are not counted — a Hyperliquid API integration can come later

## 3. Trust Scoring (`src/lib/trust.ts`)

`score = activity(0-50) + assets(0-30) + diversity(0-20) − blockPenalty(≤20)`

- **activity**: per-chain `eth_getTransactionCount` × trustWeight, summed, then log-scaled
- **assets**: native coins across the five chains + major stablecoins (whitelisted USDC/USDT on ETH/ARB/Polygon), converted to USD and bucketed
- **diversity**: number of chains with real activity (≥3 transactions or ≥$10) × 5
- **blockPenalty**: number of users who blocked you × 4, capped at 20; an additional immediate −4 is applied when a block happens
- Lazily refreshed every 24h (triggered by `/api/me`); results cached in the `users` table
- Token prices: CoinGecko (10-minute cache) → falls back to static prices from environment variables on failure
- **The score cannot be bought or modified**; future paid tiers may only raise quota caps, never change the score

Known limitation (future iteration): "address age" is not yet used (requires Etherscan V2 / Blockscout APIs);
nonce-based activity is the current approximation. When added, introduce an `EtherscanV2Adapter` (ETH/Polygon/Arb) and a
`BlockscoutAdapter` (Robinhood/HyperEVM).

## 4. Approach Quota (`src/lib/quota.ts`)

- Base daily quota by trust score: 0-29→1, 30-59→3, 60-79→8, 80-100→15
- Quota definition: the number of **new conversations initiated** during the day (UTC calendar day) — not individual messages; resets daily at 00:00 UTC
- `effective quota = base + unexpired referral bonuses − conversations initiated today`

## 5. DM Rules (`/api/threads`)

- Initiating a conversation: human only (bots get 403), target has DMs open, no block in either direction, quota remaining
- **Reply gate**: the initiator may send only 1 message until the other side replies (`replyGateBlocked`)
- The chat window has Block / Unblock; blocking applies an immediate −4 and counts toward the penalty at the next refresh
- Contact list = conversation list, follows the wallet (stored server-side per user)
- No paywall on storage during the free phase; the schema already leaves room for metered limits

## 6. Referral (`src/lib/referral.ts`)

Free-phase rewards = approach quota, no cash:

| Parameter | Value |
|---|---|
| Inviter reward | +3 quota / valid invite |
| Invitee reward | +2 quota |
| Validity | 30 days |
| Weekly valid-invite cap | 10 |
| Cumulative reward cap | +30 |
| Bots | earn no approach quota |

- A valid invite = arriving via `/r/[code]` → connecting a wallet and registering → **completing the Profile**
- The referral relationship is permanently recorded in `users.referred_by` + `referral_events` (bookkeeping for future revenue sharing)
- Future monetization: a "20% of net revenue direct-referral share" (Polymarket-style) will be layered onto the same attribution chain

## 7. Security & Compliance

| Item | Implementation |
|---|---|
| Avatar | 12 crypto-style presets + free upload. Upload pipeline: client-side canvas crop to a 256px square (which also strips EXIF) → server-side magic-byte sniffing of the real format (jpeg/png/webp) + 512KB limit → moderation hook `src/lib/moderation.ts` (uses omni-moderation when `OPENAI_API_KEY` is set, fail-closed on moderation errors; passes through when unset — **must be configured, or replaced with another provider, in production**) → stored at `data/uploads/<userId>`, served via `/api/avatar/file/[id]` (nosniff + cache headers) |
| Gender | Male/Female/Other only; visibility can be turned off |
| Assets | On-chain read-only; visible/blurred/hidden; the numbers cannot be edited |
| Links | https only; rejects raw-IP URLs, punycode, URL shorteners, dangerous TLDs (`linkfilter.ts`); Safe Browsing recommended on top in production |
| Location | Sharing on → client rounds to 0.1° (~11 km) before upload, server rounds again as a safety net; sharing off → country centroid + deterministic jitter |
| Map | maxZoom 12, never street-level precision |
| Bots | Cannot initiate conversations; passive replies are unrestricted (a bot port/webhook will open up later) |
| Login | SIWE nonce is single-use with a 10-minute expiry; session is an HttpOnly cookie valid 30 days |

MVP limitation: signature verification supports EOAs only (`recoverMessageAddress`); Safe/AA contract wallets need EIP-1271, not implemented.

## 7.5 License Staking (SIMN, `contracts/LicenseStake.sol`)

Commercial roles (event organizers / bot operators) obtain permissions self-service by staking the platform meme coin —
no manual review; abuse resistance comes from cost:

| Item | Value |
|---|---|
| Staking token | **SilMina (SIMN)** `0x2e3f8d10818807fa607be3e2AE53863d8d8F4235` (Ethereum mainnet, 18 decimals) |
| Organizer license (tier 1) | Stake 2000 SIMN; 1 position = 1 concurrent live event |
| Bot license (tier 2) | Stake 1000 SIMN; 1 position = 1 bot key |
| Entry fee | One-time 5% at stake: 3% to the platform treasury + 1% to the referrer + 1% back to the staker; with no referrer, the full 5% goes to the treasury |
| Exit | `unstake` anytime, returns 95% of principal, no second fee; `unstake` can never be paused |
| Pricing | Fixed SIMN amounts (mode A: token price up = entry bar up); owner can reprice (per generation); existing positions are unaffected; total fee rate hard-capped at 5%, immutable |
| Partner slots | `stakeFor` (owner only): the platform stakes on behalf of partners to grant permissions, no fee; refunds go back to the platform only |
| Arbitrage resistance | referral rebate 2% < fee 5%, so circular staking is a guaranteed net loss |

Off-chain companion (`src/lib/license.ts`):
- `checkLicense(address, tier)` reads `activeCount` on the contract, 60s cache, fail-closed on RPC failure
- When `LICENSE_STAKE_CONTRACT` is unset (not deployed), dev mode grants 1 position to ease development
- The trust-score floor `EVENT_MIN_TRUST` (default 0) is the safety valve if the token price drops
- Compile: `node scripts/compile-contract.mjs` (solc wasm, artifacts in `contracts/build/`)
- Deploy: `DEPLOYER_KEY=0x... node scripts/deploy-license.mjs` (Ethereum mainnet); after deploying, set the address in `LICENSE_STAKE_CONTRACT` and transfer ownership to a multisig; **get an independent security audit + a testnet dry run before mainnet**

## 7.6 Events and Map Glow

- Organizers (holding a valid tier-1 position + trust score above the floor + human + Profile completed) create events via
  `POST /api/v1/events`: title/description/coordinates/start & end times (≤30 days)/theme color/optional link
- The frontend "Creator Hub" (Dock ➕): shows SIMN balance + a Uniswap swap button; when unlicensed, one-click
  approve + stake (tier prices read live from the contract; the inviter's address is automatically passed as the on-chain referrer);
  once licensed, a built-in event creation form — the event's coordinates use the current map center (move the map to the venue first)
- NFTs are a **pure integration point** (optional): the platform has no issuance module. Any ERC-721 / ERC-1155
  issued anywhere (1155 requires a tokenId) plugs in by entering the contract address; ticket design, sales, rules, and settlement are entirely
  the organizer's business. While an event is live, users visible on the map who hold that NFT are lit with a **glowing pulse** in the event's theme color
  (`src/lib/nftgate.ts`: read-only balanceOf, 5-minute cache, at most 200 addresses per query, failures treated as not holding)
- The event itself appears on the map as a theme-colored 📅 marker (pulsing glow while live, semi-transparent before start); the top-bar "📅 Events"
  panel lists live/upcoming events, and clicking one flies to its location
- Programmatic integration: the bottom of the event creation panel has an "Open API / SDK" card with a built-in interface cheat sheet for developers and
  AI agents (full parameters of `POST /api/v1/events`); one click on "Copy for AI" lets an
  organizer's agent integrate automatically
- After an event ends the NFT needs no burning — the glow only applies within the event's time window, and the NFT itself can remain a keepsake badge

## 7.7 Tipping (SIMN, in chat)

- Pure on-chain direct transfer: the frontend uses wagmi to send a SIMN `transfer(recipient address, amount)` (Ethereum mainnet);
  the platform never touches funds, takes no cut, and puts no limit on amounts (any balance-covered amount works); anyone (including bots) can receive
- After the transaction confirms, the frontend submits the txHash to `POST /api/threads/[id]/tip`; the server verifies on-chain:
  receipt success + a `Transfer(me → recipient, >0)` on the SIMN contract; only then is a `kind='tip'`
  message inserted (storing the raw wei amount + txHash; a unique index on `tip_tx` prevents the same transaction being recorded twice)
- Rules: tips consume no approach quota and do not interact with the reply gate (neither unlock nor consume it); blocks are respected
  (a tip cannot be recorded in the conversation while blocked — the on-chain transfer itself cannot be stopped)
- The chat bubble uses a gold style with an Etherscan transaction link

## 7.75 Open-integration Layering (API as the foundation, SDK as a thin wrapper, CLI deferred)

- **API (mandatory, single source of truth for rules)**: the stake-for-permission quantity rules are enforced exactly once, server-side —
  an organizer's 1 tier-1 position = 1 concurrent live event (over quota returns 429 `EVENT_LIMIT`); bot replies
  require a valid tier-2 position (403). UI, API, SDK, and AI agents all go through the same checks — there is no way around them
- **SDK (recommended integration path, `sdk/mapsocial.mjs`)**: a zero-dependency (viem only) single-file Node
  client that wraps the biggest onboarding hurdle — SIWE login with a private key — plus `license()`,
  `createEvent()`, `threads()/reply()`, `setBotConfig()`, etc. The JSDoc spells out the
  licensing rules, so an AI agent can use it just by reading the file (full-path verification in smoke-test section 11)
- **CLI (not for now)**: the target users are operators integrating the features into their own systems and AI agents —
  neither needs a CLI; if manual ops needs arise later, one can be wrapped over the SDK in a dozen lines
- **The panels' dual-path positioning**: organizers are UI-first — the event creation panel covers the whole flow (swap → stake →
  fill the form → publish, with one-click duration presets), and the API/SDK docs card is collapsed by default under "Developer / AI access";
  operators are SDK-first — the bot creation panel puts the interface contract up front, with the zero-code path (OpenAI-compatible
  endpoint) folded away as the secondary option, auto-expanded for operators who have already enabled it

## 7.8 Bot Integration (open port, operators bring their own model)

- The platform provides only the chat window and **implements no billing logic** — pricing and business rules are entirely up to the operator
- Path A (zero code): after the bot wallet logs in, `PUT /api/bot/config` configures any OpenAI-compatible
  endpoint (apiUrl/apiKey/model/systemPrompt/enabled); incoming DMs are automatically handed to the operator's
  model to answer (`src/lib/botreply.ts` — async, 10s timeout, silent on failure; apiKey is write-only, never returned)
- Path B (fully autonomous): the bot wallet logs in via SIWE and uses the open API to poll conversations and reply
  (`GET /api/threads`, `GET/POST /api/threads/[id]`)
- Hard rules: bots never initiate DMs; replying requires a valid tier-2 stake (dev mode grants it when no contract is configured)
- The bot creation panel likewise embeds the "Open API / SDK" cheat-sheet card + one-click "Copy for AI"

## 8. Data Model (SQLite, `src/lib/db.ts`)

`users` (address, type, referral, trust-score cache, asset cache) → `profiles` (info + permissions + location)
`threads` (unique ordered pair + initiator) → `messages`
`blocks` (blocklist), `credit_grants` (quota ledger), `referral_events` (anti-abuse counters)
`auth_nonces` / `sessions` (login), `events` (events + NFT gate config),
`bot_configs` (bot operator integration config; apiKey write-only, never returned)

All numeric limits (quota table, referral parameters, refresh intervals) are centralized as constants in the lib layer; monetization is a config change.

## 9. API Overview

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/nonce` | POST | Get a SIWE nonce |
| `/api/auth/verify` | POST | Verify signature → create account (accountType/refCode) → session |
| `/api/auth/logout` | POST | Log out |
| `/api/me` | GET | Self: user+profile+quota+referral (lazily refreshes trust score) |
| `/api/profile` | PUT | Create/update Profile (first completion triggers the referral reward) |
| `/api/avatar` | POST | Upload a custom avatar (format sniffing + size limit + moderation) |
| `/api/avatar/file/[id]` | GET | Avatar image file (public, matches the Profile) |
| `/api/users/[address]` | GET | Public Profile (filtered by permissions) |
| `/api/users/[address]/block` | POST | Block / unblock (`{action}`) |
| `/api/blocklist` | GET | My blocklist |
| `/api/map/users` | GET | Map points (visible users, approx or country centroid + jitter) |
| `/api/threads` | GET/POST | Conversation list / initiate a conversation (consumes quota) |
| `/api/threads/[id]` | GET/POST | Message list / send a message (reply gate; bot messages require an on-chain operator license) |
| `/api/threads/[id]/tip` | POST | Submit a tip transaction hash (recorded after server-side on-chain verification) |
| `/api/license` | GET | Both license tiers' status for the current wallet + current-generation prices + inviter address (passed as the on-chain referrer when the client stakes) |
| `/api/bot/config` | GET/PUT | Bot integration config (OpenAI-compatible endpoint; bot accounts only; apiKey write-only, never returned) |
| `/api/v1/events` | GET/POST | Event list (public) / create an event (organizer license required) |
| `/api/map/events` | GET | Map event markers + per-event NFT-holder glow lists |

## 10. Monetization Roadmap (settled in earlier discussions; hooks left in the code)

Free phase (now): everything free + quota limits; referral pays quota only; referral relationships are recorded.
Readiness signals: stable retention, map density, quotas frequently maxed out, external API demand appearing.
After monetization: Social Pro (higher quota + more storage), Boost, API/Bot plans, token-launch tooling revenue share;
referral upgrades to a ~20% direct share of net revenue (settled in stablecoins), quota rewards retained.
Never for sale: trust score, asset-figure edits, moderation-exempt links, precise location, reply-gate exemption.

## 11. Known TODOs

- Address-age signal (Etherscan V2 + Blockscout adapters)
- EIP-1271 contract-wallet signature verification
- Non-EVM address binding (CAIP-10 multi-address)
- NFT showcase (≤5; auto-enumerate on major chains + manual entry on new chains)
- Real-time message push (currently 5s polling)
- Open API keys + rate limiting
