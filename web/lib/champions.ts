// Champion icons from Riot's Data Dragon (the asset CDN Riot provides for fan projects). Names are matched against
// Riot's own champion list, so "Jarvan IV", "Cho'Gath" or "Wukong" find the right file without a hand-kept map.
export const DDRAGON = "https://ddragon.leagueoflegends.com";

export type ChampionList = { version: string; champions: { id: string; name: string }[] };
export const championIcon = (version: string, id: string) => `${DDRAGON}/cdn/${version}/img/champion/${id}.png`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

let listCache: Promise<ChampionList | null> | undefined;

/** The latest patch's champions (id + display name), sorted by name; null if Data Dragon is unreachable. */
export function championList(): Promise<ChampionList | null> {
  return (listCache ??= (async () => {
    const [version] = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
    const { data } = (await (await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`)).json()) as { data: Record<string, { id: string; name: string }> };
    return { version, champions: Object.values(data).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
  })().catch(() => {
    listCache = undefined; // try again next time
    return null;
  }));
}

/** Resolves champion display names to icon URLs (latest patch); () => null if Data Dragon is unreachable. */
export async function championIcons(): Promise<(name: string) => string | null> {
  const list = await championList();
  if (!list) return () => null;
  const byName = new Map<string, string>();
  for (const c of list.champions) byName.set(norm(c.name), c.id).set(norm(c.id), c.id);
  return (name: string) => {
    const id = byName.get(norm(name));
    return id ? championIcon(list.version, id) : null;
  };
}
