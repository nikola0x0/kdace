/// KDAce PoC ledger: commits a fingerprint of each market's pick batch before lock,
/// and posts results afterwards. Events only, so each call stays cheap.
module kdace::ledger;

use std::string::String;
use sui::clock::Clock;
use sui::event;

/// Held by the Referee; only it can commit batches and post results.
public struct ResolverCap has key, store { id: UID }

public struct BatchCommitted has copy, drop {
    market_id: String,
    batch_hash: vector<u8>,
    pick_count: u64,
    committed_at_ms: u64,
}

public struct ResultPosted has copy, drop {
    market_id: String,
    winner: String,
    score: String,
    posted_at_ms: u64,
}

fun init(ctx: &mut TxContext) {
    transfer::transfer(ResolverCap { id: object::new(ctx) }, ctx.sender());
}

public fun commit_batch(
    _: &ResolverCap,
    market_id: String,
    batch_hash: vector<u8>,
    pick_count: u64,
    clock: &Clock,
) {
    event::emit(BatchCommitted { market_id, batch_hash, pick_count, committed_at_ms: clock.timestamp_ms() });
}

public fun post_result(_: &ResolverCap, market_id: String, winner: String, score: String, clock: &Clock) {
    event::emit(ResultPosted { market_id, winner, score, posted_at_ms: clock.timestamp_ms() });
}
