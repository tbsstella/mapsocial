# MapSocial — Wallet-Based Social Map DApp (EVM)

A wallet-native social network built around a minimalist map: connect a wallet and sign in with SIWE (zero gas), create a Profile to appear on the map, then click avatars to view profiles and send direct messages. A trust score is computed from on-chain data across five EVM chains and determines how many people you can proactively DM (cold-open) per day; inviting friends earns extra DM quota. The current phase is completely free.

## Supported Chains (unified scoring / unified asset aggregation)

The same address works across all EVM chains, so a single sign-in covers every chain:

| Chain | Chain ID | Scoring Weight |
|---|---|---|
| Ethereum | 1 | 1.0 |
| Polygon | 137 | 0.8 |
| Arbitrum One | 42161 | 0.8 |
| Robinhood Chain | 4663 | 0.5 |
| HyperEVM | 999 | 0.5 |

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3000 — any EVM wallet browser extension is required
```

Data is stored in local SQLite (`data/app.db`); no extra services needed.

## Environment Variables (all optional)

| Variable | Description |
|---|---|
| `ALCHEMY_API_KEY` | Alchemy key; a single key serves server-side RPC for all five chains (scoring / assets / licenses / tip verification). Falls back to public nodes if unset |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Alchemy key for browser-side RPC (balances / swap quotes). Exposed to the frontend, so domain allowlisting is recommended; can be the same key as above |
| `ETHEREUM_RPC` / `POLYGON_RPC` / `ARBITRUM_RPC` / `ROBINHOOD_RPC` / `HYPEREVM_RPC` | Override the RPC for an individual chain (takes precedence over Alchemy) |
| `PRICE_ETH` / `PRICE_POL` / `PRICE_HYPE` | Fallback prices when CoinGecko is unavailable |
| `IP_CHECK_URL` | IP intelligence service URL (defaults to the free ip-api.com endpoint; a commercial service is recommended in production) |
| `LICENSE_STAKE_CONTRACT` | LicenseStake contract address (if unset, event creation is allowed in dev mode) |
| `EVENT_MIN_TRUST` | Minimum trust score required to create an event (default 0) |
| `OPENAI_API_KEY` | Avatar image content moderation (omni-moderation); **required in production** — without it, uploads are not moderated |
| `UNISWAP_API_KEY` | Uniswap Trading API key (quotes and transaction building for the built-in SIMN swap, covering all v2/v3/v4 pools); falls back to on-chain Uniswap V2 quotes if unset |

## Core Rules

- Login: SIWE signature proves address ownership — no transactions, no gas
- Trust score (0–100): on-chain activity (50) + assets (30) + multi-chain coverage (20) − block penalties; refreshed every 24h, cannot be bought or edited
- Cold-open quota (daily, resets at 00:00 UTC): trust 0–29 → 1, 30–59 → 3, 60–79 → 8, 80+ → 15, plus referral bonuses
- After the first DM, you cannot send another until the recipient replies; bot accounts cannot initiate DMs
- Asset display: read-only on-chain data with three visibility levels (visible / blurred / hidden); numbers cannot be edited
- Location: when shared, only a ~11 km grid coordinate is stored (rounded client-side); otherwise only the country is shown
- Links: https only, with filtering of raw IPs / punycode / URL shorteners, etc.
- Referrals: once an invited friend completes their Profile, the inviter gets +3 and the invitee +2 cold-open quota, valid for 30 days, with weekly and lifetime caps
- VPN: proxy and datacenter IPs are detected via IP intelligence at login and daily; when detected, the public Profile is labeled "Using VPN"
- Localization: 9 built-in languages (Chinese / English / Spanish / French / German / Portuguese / Russian / Japanese / Korean), following the browser language by default; switchable after login under Profile → Permissions
- Distance units: kilometers or miles chosen automatically by the user's country (US/GB use miles)
- Country: detected server-side from the login IP (refreshed daily) and cannot be edited by the user; users only choose whether to share their fuzzy location
- Blurred wallet assets: only the number of digits is revealed (e.g. `$$$$$` means a five-digit USD amount), never the exact figure
- License staking: event hosts / bot operators stake the platform meme coin **SilMina (SIMN)** (Ethereum: `0x2e3f…4235`) to self-serve permissions — 2000 SIMN = host, 1000 SIMN = bot; a one-time 5% fee is charged at staking (3% platform + 1% referrer + 1% rebate), and 95% of the principal can be withdrawn at any time (`contracts/LicenseStake.sol`)
- Create hub: the "Create" entry in the bottom Dock provides Create Event / Create Bot buttons — showing SIMN balance and a Uniswap swap entry, with one-click approve + stake (the referrer address is automatically set as the on-chain referrer); once licensed, events can be published directly at the map center. When a bot account sends messages, its operator license is verified on-chain (`GET /api/license`)
- Events: licensed hosts publish events on the map (1 slot = 1 active event) and can set an NFT requirement — during the event, users holding that NFT glow on the map in the event's theme color, making it easy for attendees to find each other
- Tipping: tip the other person with SIMN in chat via direct wallet transfer (the platform never takes custody or a cut, and there is no limit as long as the balance suffices); after server-side verification of the on-chain transaction, a tip message is recorded in the chat. Tips do not consume cold-open quota and are not subject to the reply gate

See [docs/DEV.md](docs/DEV.md) for the detailed design.

## Tech Stack

Next.js (App Router) · TypeScript · Tailwind CSS · wagmi + viem (SIWE) ·
better-sqlite3 · MapLibre GL (CARTO minimalist basemap)
