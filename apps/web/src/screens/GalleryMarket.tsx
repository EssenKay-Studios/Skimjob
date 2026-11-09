// /dev/gallery: the black market sheet (design §12, mockup 5a) on a local engine
// game you play as p1 (no server): round 2, after someone bought Soft shoes in
// round 1. The second copy is the last round, where a "next round" perk warns.
import { useMemo, useState } from "react";
import type { PerkId } from "@skimjob/content";
import { handleCommand, replay, setupEvents, viewFor, type GameConfig, type GameEvent, type GameState, type PlayerState } from "@skimjob/engine";
import { MarketBody, MarketButton } from "../components/BlackMarket";
import { SketchFrame } from "../components/SketchFrame";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import type { ClientCommand, Reply } from "../game/useGame";

const SHOP: readonly PerkId[] = ["tail", "softShoes", "plantEvidence"];

function marketGame(roundCap?: number): GameState {
  const config: GameConfig = {
    seed: "gallery-market",
    players: ["Sam", "Ava", "Ben", "Cleo"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...(roundCap && { contentOverrides: { roundCap } }),
  };
  let s = replay(config, setupEvents(config).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "lookout" } : e.type === "shopDealt" ? { ...e, perks: SHOP } : e)));
  s = { ...s, players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...(p as PlayerState), stash: 5 }])) };
  for (const c of [
    { type: "buyPerk", player: "p2", perk: { kind: "softShoes" } },
    { type: "advance", deadline: { kind: "round", round: 1 } },
    { type: "advance", deadline: { kind: "result", round: 1 } },
  ]) {
    const r = handleCommand(s, c as Parameters<typeof handleCommand>[1]);
    if (!r.ok) throw new Error(`gallery market setup: ${r.reason}`);
    s = r.state;
  }
  return s;
}

/** A local engine game you play as p1: commands go straight to `handleCommand`. */
function useLocalGame(init: () => GameState) {
  const toast = useToast();
  const [state, setState] = useState(init);
  const view = useMemo(() => viewFor(state, "p1"), [state]);
  const send = async (cmd: ClientCommand, done?: string): Promise<Reply> => {
    const r = handleCommand(state, { ...cmd, player: "p1" } as Parameters<typeof handleCommand>[1]);
    if (!r.ok) {
      toast(r.reason, "bad");
      return { ok: false, reason: r.reason };
    }
    setState(r.state);
    if (done) toast(done, "good");
    return { ok: true };
  };
  return { view, send };
}

export function MarketSection() {
  const mid = useLocalGame(() => marketGame());
  const last = useLocalGame(() => marketGame(2));
  return (
    <SketchFrame as="section" seed="g-market" radius={16} shadow={0.5} className="g-section" aria-labelledby="g-market">
      <header className="g-section__head">
        <h3 id="g-market">
          <Underline seed="market">Black market</Underline>
        </h3>
        <p className="meta">design §12 · mockup 5a · round 2 (left, also as the sheet) and the last round (right) · a local game, buy for real</p>
      </header>
      <MarketButton view={mid.view} send={mid.send} />
      <div className="g-market">
        <div aria-label="Round 2" role="group">
          <MarketBody view={mid.view} send={mid.send} />
        </div>
        <div aria-label="The last round" role="group">
          <MarketBody view={last.view} send={last.send} />
        </div>
      </div>
    </SketchFrame>
  );
}
