# KDAce

*Pronounced "kay dee ace".* A LoL Worlds 2026 prediction board that remembers who actually reads Worlds well. Five AI analysts, one per role (Top, Jungle, Mid, ADC, Support), pick every series blind. Their picks are committed on Sui before each game through Tatum. After every series they debate the result and each one saves a lesson to **Walrus Memory** on mainnet, so they get sharper over the tournament. Every claim can be re-checked.

Built for **Total Recall** (Tatum × Walrus), Track 1: Markets & Sports Prediction.

## AXP

Every player, fan or AI analyst, starts with **10,000 AXP** and stakes it on outcomes: the winner of every series, plus the exact score for Bo3/Bo5. The leaderboard ranks by AXP balance. **AXP is play money**: it has no cash value, can't be bought, sold or transferred, and isn't a token on Sui. The bets themselves are proven on Sui: every stake is inside the batch whose fingerprint is committed before the game.

- **Parimutuel per market.** A market's pool is the sum of its stakes. Winners split the pool in proportion to their stakes, `net = floor(stake / winningStake × pool) − stake`; losers lose their stake. If nobody picked the winning outcome, everyone gets their stake back. Rounding leftovers are dropped.
- **Balance** = 10,000 + net over settled markets. **Available** = balance − stakes in markets that haven't settled yet.
- **Fans** stake at least 10 AXP per pick, up to what they have available.
- **Analysts** stake from their confidence p (50-100) and their available AXP, so anyone can recompute it: winner stake = `clamp(roundTo10(available × (p − 50) / 100), 100, available)`, score stake = `roundTo10(winner × 0.3)`, at least 10 (never past what's available; under 10 AXP available, no bet).

## Run

```bash
npm install
cp .env.example .env    # fill in the keys below
npm test                # unit tests
npm run tick            # settle finished series, then pick open ones (what launchd runs every 30 min)
npm run verify          # re-check every commit, result, lesson, AXP payout and the board
```

`.env` keys: `MEMWAL_ACCOUNT_ID`, `MEMWAL_PRIVATE_KEY`, `MEMWAL_SERVER_URL`, `TATUM_API_KEY`, `SUI_NETWORK`, `TATUM_SUI_GRPC`, `SUI_REFEREE_KEY` (create with `npx tsx scripts/new-referee-key.ts`), `KDACE_PACKAGE_ID`, `KDACE_RESOLVER_CAP`.

Going to mainnet: send ~0.5 SUI to the mainnet Referee, then `npx tsx scripts/go-mainnet.ts` (add `--dry-run` to check first). It publishes the ledger, simulates a commit, and points `.env` and GitHub Actions at mainnet. It also re-commits any batch whose game hasn't started yet on mainnet (same picks, same fingerprint, still before the game; the testnet commit is kept as `testnetCommitDigest`). Each record keeps the network it was committed on, so settled testnet records stay verifiable after the switch.

Fan picks (optional; off until Supabase is configured): fans sign in with Google (KDAce verifies the Google ID token and gives the fan their zkLogin address; no Enoki, no prover) or with any Sui wallet by signing a message, pick each open series until lock, and land on the same board. Setup:

1. Supabase project (`vercel integration add supabase`, or the dashboard). Run `supabase/migrations/*.sql` in order (SQL editor, or `supabase db push`). Then store the lock trigger's settings in Vault: `select vault.create_secret('https://<vercel-domain>/api/lock', 'kdace_lock_url'); select vault.create_secret('<LOCK_SECRET>', 'kdace_lock_secret');`
2. A Google OAuth client ID (Google Cloud console → APIs & Services → Credentials → OAuth client ID → Web application) with `http://localhost:3000`, `http://localhost` and the Vercel domains as authorized JavaScript origins (no redirect URIs needed: Google Identity Services' ID-token popup). Generate `ZKLOGIN_SALT_SECRET` once (`openssl rand -hex 32`) and **back it up**: it derives every Google fan's address and must never change.
3. Vercel env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `LOCK_SECRET`, `GOOGLE_CLIENT_ID`, `ZKLOGIN_SALT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value as `GOOGLE_CLIENT_ID`), `NEXT_PUBLIC_SUI_NETWORK`, plus the Referee settings the lock route commits with: `SUI_NETWORK`, `TATUM_API_KEY`, `SUI_REFEREE_KEY`, `KDACE_PACKAGE_ID`, `KDACE_RESOLVER_CAP`. After `go-mainnet.ts`, update those five on Vercel too (the script only updates `.env` and GitHub Actions).
4. GitHub Actions: variable `SUPABASE_URL`, secret `SUPABASE_SERVICE_ROLE_KEY` (the tick mirrors fan commits and keeps the free project awake).

Scheduled runs: GitHub Actions (`.github/workflows/tick.yml`) runs the tick every 30 minutes, then `npm run verify`. Keys live in Actions secrets, network settings in Actions variables. `scripts/launchd/` is a macOS fallback for running it locally.

## How it works

| Piece | What it does |
|---|---|
| `src/jobs/pick.ts` | Each analyst recalls its own lessons, then picks winner and score; its stakes follow from its confidence and available AXP. The batch's (every pick with its stake) SHA-256 fingerprint is committed on Sui (`ledger::commit_batch`) before the series starts. |
| `src/jobs/settle.ts` | Posts the official result (`ledger::post_result`), settles each market's AXP pool parimutuel (`src/core/points.ts`; net per player in the record's `axp`), writes the balance leaderboard, runs the analysts' debate, and saves one lesson per analyst to Walrus Memory. |
| `src/jobs/verify.ts` | Reads every transaction back through Tatum and checks: fingerprint matches the published batch, commit came before the official start, result matches, every lesson an analyst used existed before its pick, every settled market's AXP payouts recompute from the published batches, and the board recomputes. |
| `src/core/fanlock.ts` + `web/app/api/lock` | Called every minute by Supabase `pg_cron` + `pg_net`. For each series whose lock (start − 5 min) just passed, bundles every fan's final pick and stake as `fan:<address>` entries into `canonicalBatch("<matchId>:fans", …)` and commits its fingerprint on Sui under market id `<matchId>:fans`. Recorded in `fan_commits` before and after the chain call, never committed twice. |
| `src/core/fanapi.ts` + `web/app/api/{auth,picks,me}` | Sign-in, then an httpOnly signed cookie: Google (`src/core/google.ts`: ID token verified against Google's keys, salt = HMAC-SHA256(`ZKLOGIN_SALT_SECRET`, iss|sub) below 2^128, address = `jwtToAddress(token, salt)`; salt and method stored on the fan row) or a wallet (signed personal message verified server-side), picks (same markets and scores as the analysts; each with a stake of at least 10 AXP, checked against the fan's available AXP; rejected at lock on server time; last pick wins; each pick returns a receipt), crowd split with the AXP pool per outcome. SuiNS names are looked up on mainnet through Tatum and cached daily. |
| `src/jobs/fans.ts` | Tick stage: copies fan commits into `data/series/<matchId>.json` (`fans`: batch, hash, digest, chain) and fans' SuiNS names into `data/fans.json`. Settle then settles each pool among analysts and fans together, and the tick writes each fan's settled net back to Supabase (`fans.axp_settled`) for the available-AXP check; verify checks fan commits too. |
| `data/` | Every series' picks, batch, digests, debate and lessons, plus `board.json` (the leaderboard: balance, net, KDA, bets). |

## Honesty notes

- **Analysts commit when they pick**, hours before each game, not at a last-minute lock. Fans lock 5 minutes before game 1.
- **Fan picks between lock and commit:** between lock and the fan commit (normally under a minute), the database's timestamps are trusted. Verify proves the commit landed before the game started.
- **The database operator could drop a fan pick before the commit.** Receipts let each fan check that their pick is in the committed batch (`fans.batch` in `data/series/<matchId>.json`).
- **Fan picks are public before lock** (the crowd split is shown live), so fans can see each other's and the analysts' picks; analysts commit hours earlier and never see the crowd.
- **Google sign-in uses zkLogin addresses with app-managed salts**, the same model as Enoki. KDAce verifies Google's token, derives the salt, and discards the token (it's never stored, and it isn't bound to a Sui signing key). Prefer to hold your own keys? Sign in with any Sui wallet.
- **No prover on the site:** Google fans can't move assets from the KDAce site itself. The address is a standard zkLogin address, the same on testnet and mainnet; any zkLogin flow given the fan's salt reaches it.
- **`ZKLOGIN_SALT_SECRET` must be kept and never changed:** it derives every Google fan's address. `SESSION_SECRET` is the one that protects sign-in.
- **The Referee is centralized.** One key posts results from the official lolesports schedule. Anyone can check them against the official results.
- **Analysts run on Claude Haiku 5.5** through the Anthropic API (`ANTHROPIC_API_KEY`). Without a key they fall back to a local Claude Code CLI, for development only.
- **Verify limit:** Tatum's gRPC gateway blocks event listing, so `npm run verify` reads each logged transaction by digest. It can't detect a second, unlogged commit for the same match; a Sui GraphQL event query would close that gap.
- **AXP is play money**, never a token or a prize. It exists only to rank players.
- **Available AXP is checked by the server** from Supabase (the settled net the tick wrote, minus open stakes). Two picks sent at the same instant could both pass the check; settlement still pays exactly what the committed batches say.
- **Analyst stakes depend on settlement timing:** an analyst's available AXP is whatever had settled when it picked, so verify recomputes payouts from the batches but doesn't re-derive each stake.
- **Locking:** analysts must commit at least 5 minutes before the scheduled start, or the series is recorded as missed.
- **`poc/` is the proof of concept from Oct 21.** It replayed the six finished Play-In series. Those picks were made after the games, and are labelled as a replay.

## Credits

- UI effects (DitherVeil, LogoLoop, CountUp, SpotlightCard, DecryptedText) from [React Bits](https://reactbits.dev), in `web/app/ui/rb/` and `web/app/ui/DitherVeil.tsx`.
- LoL role icons from [Community Dragon](https://communitydragon.org). Team logos from the lolesports schedule. KDAce isn't endorsed by Riot Games.
