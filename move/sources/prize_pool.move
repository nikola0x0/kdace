/// KDAce season prize pool (design showcase, not live).
///
/// Sponsors put coins into a shared `PrizePool<T>` for one season. After the Worlds final the
/// Referee pays the top human players (at most 20) in one transaction, using the split below.
/// Ranking is computed off-chain from the published, on-chain-committed pick batches, so anyone
/// can recompute the winners list and check it against the `PrizesPaid` event.
///
/// Split (basis points, sums to 10_000):
///   1st 2500 · 2nd 1500 · 3rd 1000 · 4th–5th 600 each · 6th–10th 360 each · 11th–20th 200 each.
///
/// Fewer than 20 winners: the whole pool is still paid out. Each paid place gets
/// `floor(pool × bps / paid_bps)`, where `paid_bps` is the sum of the paid places' bps, so the
/// unpaid shares are spread over the paid places in proportion to their own share.
/// Rounding dust (at most `winners − 1` base units) goes to 1st place.
module kdace::prize_pool;

use kdace::ledger::ResolverCap;
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

// === Errors ===

#[error]
const EWrongPool: vector<u8> = b"This admin cap belongs to a different prize pool";
#[error]
const EAlreadyPaid: vector<u8> = b"Prizes for this pool have already been paid";
#[error]
const ENoWinners: vector<u8> = b"At least one winner is required";
#[error]
const ETooManyWinners: vector<u8> = b"At most 20 places are paid";
#[error]
const EDuplicateWinner: vector<u8> = b"A winner appears more than once";
#[error]
const EZeroAmount: vector<u8> = b"Sponsorship must be greater than zero";
#[error]
const EEmptyPool: vector<u8> = b"The pool holds nothing to pay out";

// === Constants ===

const BPS_TOTAL: u64 = 10_000;
const MAX_PLACES: u64 = 20;

// === Structs ===

/// One season's prize pool. Shared, so anyone can sponsor it.
public struct PrizePool<phantom T> has key {
    id: UID,
    season: String,
    prizes: Balance<T>,
    sponsors: vector<Sponsorship>,
    total_sponsored: u64,
    paid: bool,
}

/// One sponsorship, kept on the pool so the "Prize pool by" list is verifiable.
public struct Sponsorship has copy, drop, store {
    sponsor: address,
    amount: u64,
    name: Option<String>,
}

/// Authority to pay out one specific pool. Created with the pool, held by the Referee.
public struct PoolAdminCap has key, store {
    id: UID,
    pool_id: ID,
}

// === Events ===

public struct PoolCreated has copy, drop {
    pool_id: ID,
    season: String,
}

public struct Sponsored has copy, drop {
    pool_id: ID,
    sponsor: address,
    amount: u64,
    name: Option<String>,
    total: u64,
}

public struct PrizesPaid has copy, drop {
    pool_id: ID,
    season: String,
    total: u64,
    winners: vector<address>,
    amounts: vector<u64>,
    paid_at_ms: u64,
}

// === Public functions ===

/// Opens a season pool. Only the Referee (ResolverCap holder) can open one.
/// The pool is shared; the returned cap pays out this pool only.
public fun create<T>(_: &ResolverCap, season: String, ctx: &mut TxContext): PoolAdminCap {
    let pool = PrizePool<T> {
        id: object::new(ctx),
        season,
        prizes: balance::zero(),
        sponsors: vector[],
        total_sponsored: 0,
        paid: false,
    };
    let pool_id = object::id(&pool);
    event::emit(PoolCreated { pool_id, season: pool.season });
    transfer::share_object(pool);
    PoolAdminCap { id: object::new(ctx), pool_id }
}

/// Anyone can add to the pool before it is paid out.
public fun sponsor<T>(pool: &mut PrizePool<T>, coin: Coin<T>, name: Option<String>, ctx: &TxContext) {
    assert!(!pool.paid, EAlreadyPaid);
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);
    pool.prizes.join(coin.into_balance());
    pool.total_sponsored = pool.total_sponsored + amount;
    let sponsor = ctx.sender();
    pool.sponsors.push_back(Sponsorship { sponsor, amount, name });
    event::emit(Sponsored { pool_id: object::id(pool), sponsor, amount, name, total: pool.total_sponsored });
}

/// Pays the whole pool to `winners` (ranked, best first, at most 20) in one transaction.
public fun payout<T>(
    cap: &PoolAdminCap,
    pool: &mut PrizePool<T>,
    winners: vector<address>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(cap.pool_id == object::id(pool), EWrongPool);
    assert!(!pool.paid, EAlreadyPaid);
    let n = winners.length();
    assert!(n > 0, ENoWinners);
    assert!(n <= MAX_PLACES, ETooManyWinners);
    n.do!(|i| {
        let mut j = i + 1;
        while (j < n) {
            assert!(winners[i] != winners[j], EDuplicateWinner);
            j = j + 1;
        };
    });
    let total = pool.prizes.value();
    assert!(total > 0, EEmptyPool);

    let amounts = split_amounts(total, n);
    n.do!(|i| {
        let prize = coin::from_balance(pool.prizes.split(amounts[i]), ctx);
        transfer::public_transfer(prize, winners[i]);
    });
    pool.paid = true;

    event::emit(PrizesPaid {
        pool_id: object::id(pool),
        season: pool.season,
        total,
        winners,
        amounts,
        paid_at_ms: clock.timestamp_ms(),
    });
}

/// Basis points for a place (0-based). Places past 20 get nothing.
public fun place_bps(place: u64): u64 {
    if (place == 0) 2500
    else if (place == 1) 1500
    else if (place == 2) 1000
    else if (place < 5) 600
    else if (place < 10) 360
    else if (place < MAX_PLACES) 200
    else 0
}

/// Amounts for `n` paid places out of `total`, mirroring `prizeSplit` in src/core/prizes.ts.
/// Sum always equals `total`; dust goes to 1st.
public fun split_amounts(total: u64, n: u64): vector<u64> {
    let mut paid_bps = 0;
    n.do!(|i| paid_bps = paid_bps + place_bps(i));
    let mut amounts = vector[];
    let mut sum = 0;
    n.do!(|i| {
        let a = (((total as u128) * (place_bps(i) as u128) / (paid_bps as u128)) as u64);
        sum = sum + a;
        amounts.push_back(a);
    });
    if (n > 0) {
        let first = &mut amounts[0];
        *first = *first + (total - sum);
    };
    amounts
}

// === Getters ===

public fun season<T>(pool: &PrizePool<T>): String { pool.season }

public fun value<T>(pool: &PrizePool<T>): u64 { pool.prizes.value() }

public fun total_sponsored<T>(pool: &PrizePool<T>): u64 { pool.total_sponsored }

public fun sponsors<T>(pool: &PrizePool<T>): &vector<Sponsorship> { &pool.sponsors }

public fun paid<T>(pool: &PrizePool<T>): bool { pool.paid }

public fun pool_id(cap: &PoolAdminCap): ID { cap.pool_id }

public fun sponsor_address(s: &Sponsorship): address { s.sponsor }

public fun amount(s: &Sponsorship): u64 { s.amount }

public fun name(s: &Sponsorship): Option<String> { s.name }

/// Total basis points across all 20 places (always 10_000).
public fun bps_total(): u64 { BPS_TOTAL }
