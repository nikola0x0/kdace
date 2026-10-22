# KDAce

*Pronounced "kay dee ace".* A LoL Worlds 2026 prediction board that remembers who actually reads Worlds well. Five AI analysts, one per role (Top, Jungle, Mid, ADC, Support), pick every series blind. Their picks are committed on Sui before each game through Tatum. After every series they debate the result and each one saves a lesson to **Walrus Memory** on mainnet, so they get sharper over the tournament. Every claim can be re-checked.

Built for **Total Recall** (Tatum × Walrus), Track 1: Markets & Sports Prediction.

## Run

```bash
npm install
cp .env.example .env    # fill in the keys below
npm test                # unit tests
npm run tick            # settle finished series, then pick open ones (what launchd runs every 30 min)
npm run verify          # re-check every commit, result, lesson and the board
```

`.env` keys: `MEMWAL_ACCOUNT_ID`, `MEMWAL_PRIVATE_KEY`, `MEMWAL_SERVER_URL`, `TATUM_API_KEY`, `SUI_NETWORK`, `TATUM_SUI_GRPC`, `SUI_REFEREE_KEY` (create with `npx tsx scripts/new-referee-key.ts`), `KDACE_PACKAGE_ID`, `KDACE_RESOLVER_CAP`.

Going to mainnet: send ~0.5 SUI to the mainnet Referee, then `npx tsx scripts/go-mainnet.ts` (add `--dry-run` to check first). It publishes the ledger, simulates a commit, and points `.env` and GitHub Actions at mainnet. It also re-commits any batch whose game hasn't started yet on mainnet (same picks, same fingerprint, still before the game; the testnet commit is kept as `testnetCommitDigest`). Each record keeps the network it was committed on, so settled testnet records stay verifiable after the switch.

Fan picks (optional; off until Supabase is configured): fans sign in with Google (Enoki zkLogin) or any Sui wallet by signing a message, pick each open series until lock, and land on the same board. Setup:

1. Supabase project (`vercel integration add supabase`, or the dashboard). Run `supabase/migrations/*.sql` in order (SQL editor, or `supabase db push`). Then store the lock trigger's settings in Vault: `select vault.create_secret('https://<vercel-domain>/api/lock', 'kdace_lock_url'); select vault.create_secret('<LOCK_SECRET>', 'kdace_lock_secret');`
2. Enoki app (portal.enoki.mystenlabs.com) with a public API key and Google enabled; a Google OAuth client ID (Google Cloud console) with `http://localhost:3000` and the Vercel domains as authorized JavaScript origins and redirect URIs, added to the Enoki app.
3. Vercel env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `LOCK_SECRET`, `NEXT_PUBLIC_ENOKI_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_SUI_NETWORK`, plus the Referee settings the lock route commits with: `SUI_NETWORK`, `TATUM_API_KEY`, `SUI_REFEREE_KEY`, `KDACE_PACKAGE_ID`, `KDACE_RESOLVER_CAP`. After `go-mainnet.ts`, update those five on Vercel too (the script only updates `.env` and GitHub Actions).
4. GitHub Actions: variable `SUPABASE_URL`, secret `SUPABASE_SERVICE_ROLE_KEY` (the tick mirrors fan commits and keeps the free project awake).

Scheduled runs: GitHub Actions (`.github/workflows/tick.yml`) runs the tick every 30 minutes, then `npm run verify`. Keys live in Actions secrets, network settings in Actions variables. `scripts/launchd/` is a macOS fallback for running it locally.

## How it works

| Piece | What it does |
|---|---|
| `src/jobs/pick.ts` | Each analyst recalls its own lessons, then picks winner and score. The batch's SHA-256 fingerprint is committed on Sui (`ledger::commit_batch`) before the series starts. |
| `src/jobs/settle.ts` | Posts the official result (`ledger::post_result`), splits each market's 1000-point pot among correct picks, runs the analysts' debate, and saves one lesson per analyst to Walrus Memory. |
| `src/jobs/verify.ts` | Reads every transaction back through Tatum and checks: fingerprint matches the published batch, commit came before the official start, result matches, every lesson an analyst used existed before its pick, and the board recomputes. |
| `src/core/fanlock.ts` + `web/app/api/lock` | Called every minute by Supabase `pg_cron` + `pg_net`. For each series whose lock (start − 5 min) just passed, bundles every fan's final pick as `fan:<address>` entries into `canonicalBatch("<matchId>:fans", …)` and commits its fingerprint on Sui under market id `<matchId>:fans`. Recorded in `fan_commits` before and after the chain call, never committed twice. |
| `src/core/fanapi.ts` + `web/app/api/{auth,picks,me}` | Sign-in (personal message verified server-side, zkLogin included, then an httpOnly signed cookie), picks (same markets and scores as the analysts; rejected at lock on server time; last pick wins; each pick returns a receipt), crowd split. SuiNS names are looked up on mainnet through Tatum and cached daily. |
| `src/jobs/fans.ts` | Tick stage: copies fan commits into `data/series/<matchId>.json` (`fans`: batch, hash, digest, chain) and fans' SuiNS names into `data/fans.json`. Settle then splits each pot among analysts and fans together; verify checks fan commits too. |
| `data/` | Every series' picks, batch, digests, debate and lessons, plus `board.json`. |

## Honesty notes

- **Analysts commit when they pick**, hours before each game, not at a last-minute lock. Fans lock 5 minutes before game 1.
- **Fan picks between lock and commit:** between lock and the fan commit (normally under a minute), the database's timestamps are trusted. Verify proves the commit landed before the game started.
- **The database operator could drop a fan pick before the commit.** Receipts let each fan check that their pick is in the committed batch (`fans.batch` in `data/series/<matchId>.json`).
- **Fan picks are public before lock** (the crowd split is shown live), so fans can see each other's and the analysts' picks; analysts commit hours earlier and never see the crowd.
- **The Referee is centralized.** One key posts results from the official lolesports schedule. Anyone can check them against the official results.
- **Analysts run on Claude Haiku 5.5** through the Anthropic API (`ANTHROPIC_API_KEY`). Without a key they fall back to a local Claude Code CLI, for development only.
- **Verify limit:** Tatum's gRPC gateway blocks event listing, so `npm run verify` reads each logged transaction by digest. It can't detect a second, unlogged commit for the same match; a Sui GraphQL event query would close that gap.
- **Locking:** analysts must commit at least 5 minutes before the scheduled start, or the series is recorded as missed.
- **`poc/` is the proof of concept from Oct 21.** It replayed the six finished Play-In series. Those picks were made after the games, and are labelled as a replay.
