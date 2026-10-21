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

Scheduled runs on macOS: `cp scripts/launchd/xyz.kdace.tick.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/xyz.kdace.tick.plist`.

## How it works

| Piece | What it does |
|---|---|
| `src/jobs/pick.ts` | Each analyst recalls its own lessons, then picks winner and score. The batch's SHA-256 fingerprint is committed on Sui (`ledger::commit_batch`) before the series starts. |
| `src/jobs/settle.ts` | Posts the official result (`ledger::post_result`), splits each market's 1000-point pot among correct picks, runs the analysts' debate, and saves one lesson per analyst to Walrus Memory. |
| `src/jobs/verify.ts` | Reads every transaction back through Tatum and checks: fingerprint matches the published batch, commit came before the official start, result matches, every lesson an analyst used existed before its pick, and the board recomputes. |
| `data/` | Every series' picks, batch, digests, debate and lessons, plus `board.json`. |

## Honesty notes

- **Analysts commit when they pick**, hours before each game, not at a last-minute lock. Fans (coming for the knockouts) will lock 5 minutes before game 1.
- **The Referee is centralized.** One key posts results from the official lolesports schedule. Anyone can check them against the official results.
- **Analysts currently run on the builder's Claude Code CLI.** They'll move to a paid API before public launch.
- **Verify limit:** Tatum's gRPC gateway blocks event listing, so `npm run verify` reads each logged transaction by digest. It can't detect a second, unlogged commit for the same match; a Sui GraphQL event query would close that gap.
- **Locking:** analysts must commit at least 5 minutes before the scheduled start, or the series is recorded as missed.
- **`poc/` is the proof of concept from Oct 21.** It replayed the six finished Play-In series. Those picks were made after the games, and are labelled as a replay.
