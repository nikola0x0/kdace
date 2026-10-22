#[test_only]
module kdace::prize_pool_tests;

use kdace::ledger;
use kdace::prize_pool::{Self, PrizePool, PoolAdminCap};
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use std::unit_test::destroy;

const REFEREE: address = @0xA11CE;
const SPONSOR_A: address = @0x5A;
const SPONSOR_B: address = @0x5B;

fun sum(v: &vector<u64>): u64 { let mut t = 0; v.do_ref!(|x| t = t + *x); t }

fun winners(n: u64): vector<address> {
    vector::tabulate!(n, |i| sui::address::from_u256((i as u256) + 0x1000))
}

/// Opens a SUI pool as the Referee and returns the cap; the pool is shared.
fun open_pool(s: &mut Scenario): PoolAdminCap {
    let resolver = ledger::new_resolver_cap_for_testing(s.ctx());
    let cap = prize_pool::create<SUI>(&resolver, "worlds-2026", s.ctx());
    destroy(resolver);
    cap
}

fun give(s: &mut Scenario, who: address, amount: u64, name: Option<std::string::String>) {
    s.next_tx(who);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    prize_pool::sponsor(&mut pool, coin::mint_for_testing<SUI>(amount, s.ctx()), name, s.ctx());
    ts::return_shared(pool);
}

// === Split math ===

#[test]
fun place_bps_sum_to_ten_thousand() {
    let mut total = 0;
    25u64.do!(|i| total = total + prize_pool::place_bps(i));
    assert_eq!(total, prize_pool::bps_total());
}

#[test]
fun full_twenty_split_matches_table() {
    let a = prize_pool::split_amounts(1_000_000, 20);
    let expected = vector[
        250_000, 150_000, 100_000, 60_000, 60_000,
        36_000, 36_000, 36_000, 36_000, 36_000,
        20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
    ];
    assert_eq!(a, expected);
}

#[test]
fun rounding_dust_goes_to_first() {
    // 10_007 over 20 places: floors sum to 10_002, so 5 base units of dust land on 1st.
    let a = prize_pool::split_amounts(10_007, 20);
    assert_eq!(sum(&a), 10_007);
    assert_eq!(a[0], 2_501 + 5);
    assert_eq!(a[1], 1_501);
    assert_eq!(a[19], 200);
}

#[test]
fun fewer_than_twenty_spreads_unpaid_shares_proportionally() {
    // 3 winners: paid bps 2500 + 1500 + 1000 = 5000, so shares double.
    assert_eq!(prize_pool::split_amounts(1_000, 3), vector[500, 300, 200]);
    // 4 winners: 5600 bps; floors 44 + 26 + 17 + 10 = 97, dust 3 to 1st.
    assert_eq!(prize_pool::split_amounts(100, 4), vector[47, 26, 17, 10]);
    // 1 winner takes everything.
    assert_eq!(prize_pool::split_amounts(12_345, 1), vector[12_345]);
}

#[test]
fun split_never_loses_or_creates_coins() {
    let totals = vector[1, 19, 999, 1_000_003, 18_446_744_073_709_551_615];
    totals.do_ref!(|t| {
        20u64.do!(|i| {
            let a = prize_pool::split_amounts(*t, i + 1);
            assert_eq!(sum(&a), *t);
            assert_eq!(a.length(), i + 1);
        });
    });
}

// === Sponsor accounting ===

#[test]
fun sponsors_are_recorded_and_totalled() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 700, option::some("Team Liquid Fans"));
    give(&mut s, SPONSOR_B, 300, option::none());
    give(&mut s, SPONSOR_A, 50, option::some("Team Liquid Fans"));

    s.next_tx(REFEREE);
    let pool = s.take_shared<PrizePool<SUI>>();
    assert_eq!(pool.value(), 1_050);
    assert_eq!(pool.total_sponsored(), 1_050);
    assert_eq!(pool.season(), "worlds-2026");
    assert!(!pool.paid());
    let list = pool.sponsors();
    assert_eq!(list.length(), 3);
    assert_eq!(list[0].sponsor_address(), SPONSOR_A);
    assert_eq!(list[0].amount(), 700);
    assert_eq!(list[0].name(), option::some("Team Liquid Fans"));
    assert_eq!(list[1].sponsor_address(), SPONSOR_B);
    assert_eq!(list[1].name(), option::none());
    assert_eq!(cap.pool_id(), object::id(&pool));
    ts::return_shared(pool);
    destroy(cap);
    s.end();
}

#[test, expected_failure(abort_code = prize_pool::EZeroAmount, location = prize_pool)]
fun zero_sponsorship_aborts() {
    let mut s = ts::begin(REFEREE);
    let _cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 0, option::none());
    abort
}

// === Payout ===

#[test]
fun payout_pays_every_place_in_one_transaction() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 6_000, option::some("Sponsor A"));
    give(&mut s, SPONSOR_B, 4_000, option::none());

    s.next_tx(REFEREE);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    let clk = clock::create_for_testing(s.ctx());
    let ws = winners(3);
    prize_pool::payout(&cap, &mut pool, ws, &clk, s.ctx());
    assert_eq!(pool.value(), 0);
    assert!(pool.paid());
    ts::return_shared(pool);

    let expected = vector[5_000, 3_000, 2_000];
    3u64.do!(|i| {
        s.next_tx(ws[i]);
        let prize = s.take_from_sender<Coin<SUI>>();
        assert_eq!(prize.value(), expected[i]);
        destroy(prize);
    });
    destroy(clk);
    destroy(cap);
    s.end();
}

#[test, expected_failure(abort_code = prize_pool::EWrongPool, location = prize_pool)]
fun only_this_pools_cap_can_pay_out() {
    let mut s = ts::begin(REFEREE);
    let _cap_a = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 1_000, option::none());
    s.next_tx(REFEREE);
    let mut pool_a = s.take_shared<PrizePool<SUI>>();
    // A second pool's cap must not move pool A's funds.
    let cap_b = open_pool(&mut s);
    let clk = clock::create_for_testing(s.ctx());
    prize_pool::payout(&cap_b, &mut pool_a, winners(1), &clk, s.ctx());
    abort
}

#[test, expected_failure(abort_code = prize_pool::EAlreadyPaid, location = prize_pool)]
fun second_payout_aborts() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 1_000, option::none());
    s.next_tx(REFEREE);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    let clk = clock::create_for_testing(s.ctx());
    prize_pool::payout(&cap, &mut pool, winners(2), &clk, s.ctx());
    prize_pool::payout(&cap, &mut pool, winners(2), &clk, s.ctx());
    abort
}

#[test, expected_failure(abort_code = prize_pool::EAlreadyPaid, location = prize_pool)]
fun sponsoring_after_payout_aborts() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 1_000, option::none());
    s.next_tx(REFEREE);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    let clk = clock::create_for_testing(s.ctx());
    prize_pool::payout(&cap, &mut pool, winners(1), &clk, s.ctx());
    ts::return_shared(pool);
    give(&mut s, SPONSOR_B, 10, option::none());
    abort
}

#[test, expected_failure(abort_code = prize_pool::ETooManyWinners, location = prize_pool)]
fun more_than_twenty_winners_aborts() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 1_000, option::none());
    s.next_tx(REFEREE);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    let clk = clock::create_for_testing(s.ctx());
    prize_pool::payout(&cap, &mut pool, winners(21), &clk, s.ctx());
    abort
}

#[test, expected_failure(abort_code = prize_pool::EDuplicateWinner, location = prize_pool)]
fun duplicate_winner_aborts() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 1_000, option::none());
    s.next_tx(REFEREE);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    let clk = clock::create_for_testing(s.ctx());
    prize_pool::payout(&cap, &mut pool, vector[@0x1, @0x2, @0x1], &clk, s.ctx());
    abort
}

#[test, expected_failure(abort_code = prize_pool::ENoWinners, location = prize_pool)]
fun empty_winner_list_aborts() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    give(&mut s, SPONSOR_A, 1_000, option::none());
    s.next_tx(REFEREE);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    let clk = clock::create_for_testing(s.ctx());
    prize_pool::payout(&cap, &mut pool, vector[], &clk, s.ctx());
    abort
}

#[test, expected_failure(abort_code = prize_pool::EEmptyPool, location = prize_pool)]
fun paying_an_empty_pool_aborts() {
    let mut s = ts::begin(REFEREE);
    let cap = open_pool(&mut s);
    s.next_tx(REFEREE);
    let mut pool = s.take_shared<PrizePool<SUI>>();
    let clk = clock::create_for_testing(s.ctx());
    prize_pool::payout(&cap, &mut pool, winners(1), &clk, s.ctx());
    abort
}
