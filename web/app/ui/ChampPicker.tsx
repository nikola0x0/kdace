"use client";
// Pick up to two favourite champions: a searchable grid of every champion's icon. Saves on "Save".
import { Check, Search } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useFans } from "./FanProvider";
import { useChampions } from "./useChampions";

export default function ChampPicker({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { me, updateProfile } = useFans();
  const { champions, icon, name } = useChampions();
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setPicked(me?.favChamps ?? []);
      setQ("");
    }
  }, [open, me?.favChamps]);

  const shown = useMemo(() => {
    const n = q.toLowerCase().replace(/[^a-z]/g, "");
    return n ? champions.filter((c) => c.name.toLowerCase().replace(/[^a-z]/g, "").includes(n)) : champions;
  }, [champions, q]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : [p[1], id]));

  async function save() {
    setSaving(true);
    if (await updateProfile({ favChamps: picked })) {
      toast.success(picked.length ? `Mains set: ${picked.map(name).join(" & ")}` : "Mains cleared");
      onOpenChange(false);
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 border-border bg-[#0b0b0b] p-5 sm:max-w-[520px]">
        <DialogTitle className="text-lg font-bold">Your mains</DialogTitle>
        <DialogDescription>Pick up to two champions. They show next to your name on the leaderboard.</DialogDescription>
        <div className="flex items-center gap-3">
          {[0, 1].map((i) => (
            <span key={i} className="grid size-12 place-items-center overflow-hidden rounded-full border border-dashed border-input bg-secondary">
              {picked[i] && <motion.img key={picked[i]} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} src={icon(picked[i]) ?? ""} alt={name(picked[i])} className="size-full object-cover" />}
            </span>
          ))}
          <span className="text-sm text-muted-foreground">{picked.length ? picked.map(name).join(" & ") : "None yet"}</span>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-input bg-secondary px-3">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search champions" className="h-10 flex-1 bg-transparent text-sm outline-none" autoFocus />
        </label>
        <div className="grid max-h-[300px] grid-cols-6 gap-2 overflow-y-auto pr-1 sm:grid-cols-8">
          {shown.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)} title={c.name} className="group relative grid justify-items-center gap-1">
                <span className={cn("relative size-11 overflow-hidden rounded-lg border-2 transition", on ? "border-win" : "border-transparent opacity-80 group-hover:opacity-100")}>
                  <img src={icon(c.id) ?? ""} alt="" loading="lazy" className="size-full object-cover" />
                  {on && <span className="absolute inset-0 grid place-items-center bg-black/40"><Check className="size-5 text-win" strokeWidth={3} /></span>}
                </span>
                <span className="w-full truncate text-center text-[10px] text-muted-foreground">{c.name}</span>
              </button>
            );
          })}
          {!champions.length && <p className="col-span-full text-sm text-muted-foreground">Loading champions…</p>}
          {champions.length > 0 && !shown.length && <p className="col-span-full text-sm text-muted-foreground">No champion matches “{q}”.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn ghost" onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={saving}>Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
