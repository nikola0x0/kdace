// One job at a time: an exclusive lockfile in the data directory. A lock older than 2 hours is a crashed run and is reclaimed.
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

const STALE_MS = 2 * 3600_000;

export async function withLock<T>(dir: string, job: () => Promise<T>): Promise<T> {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, ".lock");
  try {
    if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path);
  } catch {}
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch {
    throw new Error(`Another KDAce job is already running (${path})`);
  }
  writeSync(fd, String(process.pid));
  closeSync(fd);
  try {
    return await job();
  } finally {
    rmSync(path, { force: true });
  }
}
