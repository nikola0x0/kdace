// Champion icons from Riot's Data Dragon (the asset CDN Riot provides for fan projects). Names are matched against
// Riot's own champion list, so "Jarvan IV", "Cho'Gath" or "Wukong" find the right file without a hand-kept map.
const DDRAGON = "https://ddragon.leagueoflegends.com";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

let cache: Promise<(name: string) => string | null> | undefined;

/** Resolves champion display names to icon URLs (latest patch). Resolves to () => null if Data Dragon is unreachable. */
export function championIcons(): Promise<(name: string) => string | null> {
  return (cache ??= (async () => {
    const [version] = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
    const { data } = (await (await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`)).json()) as { data: Record<string, { id: string; name: string }> };
    const byName = new Map<string, string>();
    for (const c of Object.values(data)) byName.set(norm(c.name), c.id).set(norm(c.id), c.id);
    return (name: string) => {
      const id = byName.get(norm(name));
      return id ? `${DDRAGON}/cdn/${version}/img/champion/${id}.png` : null;
    };
  })().catch(() => () => null));
}
