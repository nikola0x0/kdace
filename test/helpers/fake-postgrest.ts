// A small in-memory PostgREST for tests: the subset of the REST API SupabaseStore and SupabaseRunnerDb use (select,
// eq/in filters, order, insert with 409 on a duplicate key, upsert with on_conflict, conditional PATCH, and the runner
// lock functions), plus fault injection (network errors, 5xx, a write that lands but whose response is lost).
type Row = Record<string, unknown>;

const KEYS: Record<string, string> = { series_records: "match_id", title_days: "date", record_docs: "key", scout_data: "key", runner_state: "stage" };

export type Fault = "network" | "503" | "lost-response";

export class FakePostgrest {
  tables: Record<string, Row[]> = { series_records: [], title_days: [], record_docs: [], scout_data: [], runner_state: [] };
  lock = { holder: null as string | null, expiresAt: 0 };
  calls: { method: string; path: string; body: unknown; prefer?: string }[] = [];
  /** Faults applied to the next requests, in order (one per request). */
  faults: Fault[] = [];
  now = () => Date.now();

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    this.calls.push({ method, path: path + url.search, body, prefer: headers.Prefer });
    const fault = this.faults.shift();
    if (fault === "network") throw new TypeError("fetch failed");
    if (fault === "503") return new Response(JSON.stringify({ message: "unavailable" }), { status: 503 });
    const res = this.handle(method, path, url.searchParams, body, headers.Prefer ?? "");
    if (fault === "lost-response") throw new TypeError("fetch failed (response lost)");
    return new Response(res.json === undefined ? null : JSON.stringify(res.json), { status: res.status });
  }) as typeof fetch;

  private handle(method: string, path: string, q: URLSearchParams, body: any, prefer: string): { status: number; json?: unknown } {
    if (path.startsWith("rpc/")) return this.rpc(path.slice(4), body);
    const rows = this.tables[path];
    if (!rows) return { status: 404, json: { message: `no table ${path}` } };
    const key = KEYS[path];
    const filters = [...q.entries()].filter(([k]) => !["select", "order", "on_conflict", "limit"].includes(k));
    const match = (r: Row) =>
      filters.every(([col, f]) => {
        if (f.startsWith("eq.")) return String(r[col]) === decodeURIComponent(f.slice(3));
        if (f.startsWith("in.(")) return f.slice(4, -1).split(",").map((v) => decodeURIComponent(v).replace(/^"|"$/g, "")).includes(String(r[col]));
        throw new Error(`unsupported filter ${col}=${f}`);
      });
    const copy = (r: Row) => JSON.parse(JSON.stringify(r)) as Row;
    if (method === "GET") {
      let out = rows.filter(match).map(copy);
      const order = q.get("order");
      if (order) {
        const col = order.split(".")[0];
        out.sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      }
      const select = q.get("select");
      if (select && select !== "*") out = out.map((r) => Object.fromEntries(select.split(",").map((c) => [c, r[c]])));
      return { status: 200, json: out };
    }
    if (method === "POST") {
      const input: Row[] = Array.isArray(body) ? body : [body];
      const upsert = q.get("on_conflict") && prefer.includes("resolution=merge-duplicates");
      for (const r of input) {
        const i = rows.findIndex((x) => x[key] === r[key]);
        if (i >= 0 && !upsert) return { status: 409, json: { message: "duplicate key value violates unique constraint" } };
        if (i >= 0) rows[i] = { ...rows[i], ...copy(r) };
        else rows.push({ version: 1, ...copy(r) });
      }
      return { status: 201 };
    }
    if (method === "PATCH") {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, copy(body));
      return { status: 200, json: prefer.includes("return=representation") ? hit.map(copy) : undefined };
    }
    return { status: 405 };
  }

  private rpc(fn: string, body: any): { status: number; json?: unknown } {
    if (fn === "acquire_runner_lock") {
      const now = this.now();
      if (this.lock.expiresAt < now || this.lock.holder === body.p_holder) {
        this.lock = { holder: body.p_holder, expiresAt: now + body.p_ttl_seconds * 1000 };
        return { status: 200, json: true };
      }
      return { status: 200, json: false };
    }
    if (fn === "release_runner_lock") {
      if (this.lock.holder === body.p_holder) this.lock = { holder: null, expiresAt: 0 };
      return { status: 204 };
    }
    return { status: 404, json: { message: `no function ${fn}` } };
  }
}
