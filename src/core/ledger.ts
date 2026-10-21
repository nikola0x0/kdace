// KDAce ledger calls on Sui through Tatum: commit a batch fingerprint, post a result, read either back by digest.
import { Transaction } from "@mysten/sui/transactions";
import { env } from "./env.ts";
import { refereeKeypair, tatumClient } from "./sui.ts";

type LedgerEvent = { type: "BatchCommitted" | "ResultPosted"; json: Record<string, unknown> };

async function callLedger(fn: "commit_batch" | "post_result", args: (tx: Transaction) => any[]): Promise<string> {
  const sui = tatumClient();
  const tx = new Transaction();
  tx.moveCall({ target: `${env("KDACE_PACKAGE_ID")}::ledger::${fn}`, arguments: args(tx) });
  const res = await sui.signAndExecuteTransaction({ signer: refereeKeypair(), transaction: tx, include: { effects: true } });
  if (res.$kind !== "Transaction") throw new Error(`${fn} failed: ${JSON.stringify(res.FailedTransaction?.effects?.status)}`);
  await sui.waitForTransaction({ digest: res.Transaction.digest });
  return res.Transaction.digest;
}

export const commitBatch = (matchId: string, batchHashHex: string, pickCount: number) =>
  callLedger("commit_batch", (tx) => [
    tx.object(env("KDACE_RESOLVER_CAP")),
    tx.pure.string(matchId),
    tx.pure.vector("u8", Buffer.from(batchHashHex, "hex")),
    tx.pure.u64(pickCount),
    tx.object.clock(),
  ]);

export const postResult = (matchId: string, winner: string, score: string) =>
  callLedger("post_result", (tx) => [tx.object(env("KDACE_RESOLVER_CAP")), tx.pure.string(matchId), tx.pure.string(winner), tx.pure.string(score), tx.object.clock()]);

export async function readLedgerEvent(digest: string): Promise<LedgerEvent | null> {
  const tx = await tatumClient().getTransaction({ digest, include: { events: true } });
  if (tx.$kind !== "Transaction") return null;
  const prefix = `${env("KDACE_PACKAGE_ID")}::ledger::`;
  const event = (tx.Transaction.events ?? []).find((e) => e.eventType.startsWith(prefix));
  if (!event) return null;
  return { type: event.eventType.slice(prefix.length) as LedgerEvent["type"], json: event.json ?? {} };
}
