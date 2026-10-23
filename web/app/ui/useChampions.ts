"use client";
// The champion list (fetched once per page load) and an icon lookup by Data Dragon id.
import { useEffect, useState } from "react";
import { championIcon, type ChampionList } from "../../lib/champions";

let loading: Promise<ChampionList | null> | undefined;
const load = () => (loading ??= fetch("/api/champions").then((r) => (r.ok ? r.json() : null)).catch(() => null));

export function useChampions() {
  const [list, setList] = useState<ChampionList | null>(null);
  useEffect(() => {
    load().then(setList);
  }, []);
  // Accepts a Data Dragon id ("JarvanIV") or a display name ("Jarvan IV").
  const find = (key: string) => {
    const n = key.toLowerCase().replace(/[^a-z]/g, "");
    return list?.champions.find((c) => c.id === key || c.id.toLowerCase() === n || c.name.toLowerCase().replace(/[^a-z]/g, "") === n);
  };
  return {
    champions: list?.champions ?? [],
    icon: (key: string) => {
      const c = find(key);
      return list && c ? championIcon(list.version, c.id) : null;
    },
    name: (key: string) => find(key)?.name ?? key,
  };
}
