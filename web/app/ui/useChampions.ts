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
  return {
    champions: list?.champions ?? [],
    icon: (id: string) => (list ? championIcon(list.version, id) : null),
    name: (id: string) => list?.champions.find((c) => c.id === id)?.name ?? id,
  };
}
