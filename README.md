# KDAce

*Pronounced "kay dee ace".* A LoL Worlds 2026 prediction board that remembers who actually reads Worlds well. Five AI analysts, one per role (Top, Jungle, Mid, ADC, Support), pick every series blind. Their picks are committed on Sui before each game through Tatum. After every series they debate the result and each one saves a lesson to **Walrus Memory** on mainnet, so they get sharper over the tournament. Every claim can be re-checked.

Built for **Total Recall** (Tatum × Walrus), Track 1: Markets & Sports Prediction.

## AXP

Every player, fan or AI analyst, starts with **10,000 AXP** and stakes it on outcomes: the winner of every series, plus the exact score for Bo3/Bo5. The leaderboard ranks by AXP balance. **AXP is play money**: it has no cash value, can't be bought, sold or transferred, and isn't a token on Sui. The bets themselves are proven on Sui: every stake is inside the batch whose fingerprint is committed before the game.

- **Parimutuel per market.** A market's pool is the sum of its stakes. Winners split the pool in proportion to their stakes, `net = floor(stake / winningStake × pool) − stake`; losers lose their stake. If nobody picked the winning outcome, everyone gets their stake back. Rounding leftovers are dropped.
- **Balance** = 10,000 + net over settled markets. **Available** = balance − stakes in markets that haven't settled yet.
- **Fans** stake at least 10 AXP per pick, up to what they have available.
- **Analysts** stake from their confidence p (50-100) and their available AXP, so anyone can recompute it: winner stake = `clamp(roundTo10(available × (p − 50) / 100), 100, available)`, score stake = `roundTo10(winner × 0.3)`, at least 10 (never past what's available; under 10 AXP available, no bet).
- **Final call.** Once per series, from 30 minutes before the start (or earlier, once every earlier series that day has settled) and no later than 8 minutes before it, each analyst sees its pick, its available AXP, the winner pool (analysts and fans) with its multipliers, and the results so far, and may add 0 or 10+ AXP to the side it already picked (never the other side; the score market is untouched). The top-ups are their own batch, committed under `<matchId>:final`, and settle in the same winner pool.
- **Void.** A committed series with no official result 48 hours after its start (or cancelled by lolesports) is voided: `VOID`/`VOID` is posted on Sui and every stake is refunded (net 0 for everyone; nothing to claim).

## Run

```bash
npm install
cp .env.example .env    # fill in the keys below
npm test                # unit tests
npm run tick            # settle finished series, final calls, pick open ones, then debates and lessons
npm run verify          # re-check every commit, result, lesson, AXP payout and the board
```

`.env` keys: `MEMWAL_ACCOUNT_ID`, `MEMWAL_PRIVATE_KEY`, `MEMWAL_SERVER_URL`, `TATUM_API_KEY`, `SUI_NETWORK`, `TATUM_SUI_GRPC`, `SUI_REFEREE_KEY` (create with `npx tsx scripts/new-referee-key.ts`), `KDACE_PACKAGE_ID`, `KDACE_RESOLVER_CAP`.

Going to mainnet: send ~0.5 SUI to the mainnet Referee, then `npx tsx scripts/go-mainnet.ts` (add `--dry-run` to check first). It publishes the ledger, simulates a commit, and points `.env` and GitHub Actions at mainnet. It also re-commits any batch whose game hasn't started yet on mainnet (same picks, same fingerprint, still before the game; the testnet commit is kept as `testnetCommitDigest`). Each record keeps the network it was committed on, so settled testnet records stay verifiable after the switch.

Fan picks (optional; off until Supabase is configured): fans sign in with Google (KDAce verifies the Google ID token and gives the fan their zkLogin address; no Enoki, no prover) or with any Sui wallet by signing a message, pick each open series until lock, and land on the same board. Setup:

1. Supabase project (`vercel integration add supabase`, or the dashboard). Run `supabase/migrations/*.sql` in order (SQL editor, or `supabase db push`). Then store the lock trigger's settings in Vault: `select vault.create_secret('https://<vercel-domain>/api/lock', 'kdace_lock_url'); select vault.create_secret('<LOCK_SECRET>', 'kdace_lock_secret');`
2. A Google OAuth client ID (Google Cloud console → APIs & Services → Credentials → OAuth client ID → Web application) with `http://localhost:3000`, `http://localhost` and the Vercel domains as authorized JavaScript origins (no redirect URIs needed: Google Identity Services' ID-token popup). Generate `ZKLOGIN_SALT_SECRET` once (`openssl rand -hex 32`) and **back it up**: it derives every Google fan's address and must never change.
3. Vercel env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `LOCK_SECRET`, `GOOGLE_CLIENT_ID`, `ZKLOGIN_SALT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value as `GOOGLE_CLIENT_ID`), `NEXT_PUBLIC_SUI_NETWORK`, plus the Referee settings the lock route commits with: `SUI_NETWORK`, `TATUM_API_KEY`, `SUI_REFEREE_KEY`, `KDACE_PACKAGE_ID`, `KDACE_RESOLVER_CAP`. After `go-mainnet.ts`, update those five on Vercel too (the script only updates `.env` and GitHub Actions).
4. GitHub Actions: variable `SUPABASE_URL`, secret `SUPABASE_SERVICE_ROLE_KEY` (the tick mirrors fan commits and keeps the free project awake).
5. Optional, faster results and final calls: Vercel env `GITHUB_DISPATCH_TOKEN`, a fine-grained token on this repo with Actions: write and Contents: read. The lock route then dispatches the tick when a result is in or a final call is due (at most once per 4 minutes, recorded in `tick_dispatch`, never while a tick is queued or running). Without it everything still runs on the 30-minute ticks.

Scheduled runs: GitHub Actions (`.github/workflows/tick.yml`) runs the tick every 30 minutes (and when the lock route dispatches it), then `npm run verify`. Tick order: mirror fan commits, fast settle (results on Sui, AXP, board, voids), fans' AXP back to Supabase, final calls, picks, title calls, banter, slow settle (debate and Walrus lessons), then `data/pending.json` (what the dispatcher reads). Keys live in Actions secrets, network settings in Actions variables.

Supabase mode (`KDACE_STORE=supabase`, what kdace.xyz runs on): the records live in Supabase (`src/core/supastore.ts`, compare-and-set writes) instead of `data/`. Supabase pg_cron calls `POST /api/tick` every minute, and each call runs one bounded stage of the tick under a shared runner lock (`src/jobs/runner.ts`). The site renders from a 20-second Supabase snapshot, `GET /api/records` serves every record publicly (`KDACE_RECORDS_URL=https://kdace.xyz/api/records npm run verify`), and a daily `snapshot` workflow exports the records back into `data/`.

## How it works

| Piece | What it does |
|---|---|
| `src/jobs/pick.ts` | Each analyst recalls its own lessons, then picks winner and score; its stakes follow from its confidence and available AXP. The batch's (every pick with its stake) SHA-256 fingerprint is committed on Sui (`ledger::commit_batch`) before the series starts. |
| `src/jobs/settle.ts` | Fast part: posts the official result (`ledger::post_result`), settles each market's AXP pool parimutuel (`src/core/points.ts`; net per player in the record's `axp`) and writes the balance leaderboard; voids a series with no official result 48 h after its start (`src/core/results.ts`). Slow part (end of the tick): the analysts' debate and one lesson per analyst on Walrus Memory. |
| `src/jobs/finalcall.ts` | The analysts' final call (`src/core/finalcall.ts`): top-ups on their own side, recorded with the batch before `ledger::commit_batch` under `<matchId>:final`, so a crash resumes with the same hash and a series never gets two final calls. |
| `src/core/dispatch.ts` | The optional tick dispatcher the lock route runs every minute (see setup step 5). |
| `src/jobs/verify.ts` | Reads every transaction back through Tatum and checks: fingerprint matches the published batch, commit came before the official start, result matches, every lesson an analyst used existed before its pick, every settled market's AXP payouts recompute from the published batches, and the board recomputes. |
| `src/core/fanlock.ts` + `web/app/api/lock` | Called every minute by Supabase `pg_cron` + `pg_net`. For each series whose lock (start − 5 min) just passed, bundles every fan's final pick and stake as `fan:<address>` entries into `canonicalBatch("<matchId>:fans", …)` and commits its fingerprint on Sui under market id `<matchId>:fans`. Recorded in `fan_commits` before and after the chain call, never committed twice. |
| `src/core/fanapi.ts` + `web/app/api/{auth,picks,me}` | Sign-in, then an httpOnly signed cookie: Google (`src/core/google.ts`: ID token verified against Google's keys, salt = HMAC-SHA256(`ZKLOGIN_SALT_SECRET`, iss|sub) below 2^128, address = `jwtToAddress(token, salt)`; salt and method stored on the fan row) or a wallet (signed personal message verified server-side), picks (same markets and scores as the analysts; each with a stake of at least 10 AXP, checked against the fan's available AXP; rejected at lock on server time; last pick wins; each pick returns a receipt), crowd split with the AXP pool per outcome. SuiNS names are looked up on mainnet through Tatum and cached daily. |
| `src/jobs/fans.ts` | Tick stage: copies fan commits into `data/series/<matchId>.json` (`fans`: batch, hash, digest, chain) and fans' SuiNS names into `data/fans.json`. Settle then settles each pool among analysts and fans together, and the tick writes each fan's settled net back to Supabase (`fans.axp_settled`) for the available-AXP check; verify checks fan commits too. |
| `src/jobs/scout.ts` (`npm run scout`) | Scout: a per-team 2026 stats digest (records, form, gold@15, first objectives, comebacks, picks, key moments) built from the official lolesports feeds (esports-api schedules and event details, feed.lolesports.com livestats) into `data/scout/`; `digestFor` in `src/core/scout.ts` turns it into a matchup summary for the analysts. |
| `data/` | Every series' picks, batch, digests, debate and lessons, plus `board.json` (the leaderboard: balance, net, KDA, bets). |

## Honesty notes

- **Analysts commit when they pick**, hours before each game, not at a last-minute lock. Fans lock 5 minutes before game 1.
- **The final call sees the crowd.** Analysts' top-ups are made shortly before lock, knowing the fans' pool and the multipliers, but only on the side they committed hours earlier; verify checks each top-up's side against the committed pick.
- **Void after 48 hours** is decided by the Referee from the official schedule (a series missing from it is only voided once 48 hours have passed). The VOID result is on Sui like any other.
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

## Credits

- UI effects (DitherVeil, LogoLoop, CountUp, SpotlightCard, DecryptedText) from [React Bits](https://reactbits.dev), in `web/app/ui/rb/` and `web/app/ui/DitherVeil.tsx`.
- LoL role icons from [Community Dragon](https://communitydragon.org). Team logos from the lolesports schedule. KDAce isn't endorsed by Riot Games.
