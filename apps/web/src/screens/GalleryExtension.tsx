// /dev/gallery sections for role facts and tappable role names (design §11,
// §20.2), the rulebook with the black market (§12), the no-tells feed lines and
// the end screen. No server: a local engine game.
import { useMemo, useState, type ReactNode } from "react";
import type { RoleId } from "@skimjob/content";
import {
  PUBLIC,
  handleCommand,
  replay,
  setupEvents,
  privateTo,
  viewFor,
  type GameConfig,
  type GameState,
  type PlayerView,
  type SystemCommand,
} from "@skimjob/engine";
import { RoleFacts, RoleList, RoleTip, RulebookButton } from "../components/Extension";
import { SketchFrame } from "../components/SketchFrame";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { describeEvent } from "../game/describeEvent";
import { roleInfo } from "../game/extension";
import type { ClientCommand, Reply } from "../game/useGame";
import { GameOver } from "./Game";
import { RoleCard } from "./Meetings";

const NAMES = ["Ana", "Ben", "Cy", "Dot"];
const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "gallery-ext",
  players: NAMES.map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});
/** A new local game with these roles dealt in seat order, so the gallery always shows the same cards. */
const GALLERY_ROLES: readonly RoleId[] = ["lookout", "auditor", "detective", "smoothTalker"];
const createGame = (c: GameConfig): GameState => {
  let seat = 0;
  return replay(c, setupEvents(c).map((e) => (e.type === "roleDealt" ? { ...e, role: GALLERY_ROLES[seat++] as RoleId } : e)));
};
const round = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "round", round: r } });
const alibis = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "alibis", round: r } });
const step = (s: GameState, c: Parameters<typeof handleCommand>[1]) => {
  const r = handleCommand(s, c);
  return r.ok ? r.state : s;
};

/** Rounds 1–3 played with default moves; nobody calls an emergency (design §9.3). */
function playedGame(): GameState {
  let s = createGame(config({ eventsEnabled: false }));
  for (let r = 1; r <= 3; r++) {
    s = step(s, round(r));
    if (r === 1) s = step(s, { type: "postAlibi", player: "p2", room: "vault" });
    s = step(s, alibis(r));
    s = step(s, { type: "advance", deadline: { kind: "result", round: r } });
  }
  return s;
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <SketchFrame as="section" seed={`g-${id}`} radius={16} shadow={0.5} className="g-section" aria-labelledby={`g-${id}`}>
      <header className="g-section__head">
        <h3 id={`g-${id}`}>
          <Underline seed={id}>{title}</Underline>
        </h3>
        {note && <p className="meta">{note}</p>}
      </header>
      {children}
    </SketchFrame>
  );
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
  return { state, setState, view, send };
}

export function ExtensionSections() {
  return (
    <>
      <RoleSections />
      <NoTellsSection />
      <EndSection />
    </>
  );
}

function RoleSections() {
  const game = useLocalGame(() => createGame(config()));
  const sample: RoleId[] = ["lookout", "locksmith", "hacker", "mole", "fixer"];
  return (
    <>
      <Section id="ext-role-card" title="Role card" note="design §11, §20.2 · kind, power, How you win, role list, rulebook">
        <RoleCard view={game.view} send={game.send} />
      </Section>
      <Section id="ext-roles" title="Role facts and role names" note="every role card carries its kind and a How you win line · tap a name for its kind and win line">
        <div className="g-stack">
          {sample.map((r) => (
            <div key={r} className="g-ext-role">
              <p>
                <RoleTip id={r} />
              </p>
              <RoleFacts info={roleInfo(r)} />
            </div>
          ))}
        </div>
      </Section>
      <Section id="ext-rulebook" title="Rulebook sheet" note="game in a minute, Endings table, roles by kind with ★, the black market · numbers from content">
        <div className="g-row">
          <RulebookButton view={null} seed="g-rulebook-content" />
          <RulebookButton view={game.view} seed="g-rulebook-game" />
        </div>
        <p className="meta">Left: outside a game (every perk). Right: this game's role list and three-perk black market.</p>
      </Section>
      <Section id="ext-rolelist" title="Role list" note="host setting: Exact, Possible or Hidden">
        <div className="g-stack">
          {(["exact", "possible", "hidden"] as const).map((list) => (
            <RoleList key={list} view={viewFor(createGame(config({ roleList: list })), "p1")} />
          ))}
        </div>
      </Section>
    </>
  );
}

/** extension.md Situations, design §5.2: a Mole's ring reads like any ring. */
function NoTellsSection() {
  const ctx = { me: "p1", name: (p: string) => NAMES[Number(p.slice(1)) - 1] ?? p };
  const feed = { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 4, source: "security", room: "vault", seen: [], offline: true } as const;
  const bells = { type: "bellsRung", visibility: PUBLIC, round: 5, bells: { vault: 0, office: 2, lobby: 0, security: 0, rooftop: 0 }, hidden: [] } as const;
  return (
    <Section id="ext-notells" title="Cameras offline and a bell's ring" note="the same line whatever caused it: no tells">
      <dl className="g-stack">
        <dt className="meta">A power cut</dt>
        <dd>{describeEvent(feed, ctx)}</dd>
        <dt className="meta">Mole's ring and a grab</dt>
        <dd>{describeEvent(bells, ctx)}</dd>
        <dt className="meta">Two grabs</dt>
        <dd>{describeEvent(bells, ctx)}</dd>
      </dl>
    </Section>
  );
}

function EndSection() {
  const base = useMemo(() => viewFor(playedGame(), "p1"), []);
  const ranking = base.players.map((p, i) => ({ player: p.id, role: (["hacker", "locksmith", "lookout", "mole"] as const)[i]!, stash: 30 - i * 6 }));
  const ended = (outcome: Extract<PlayerView["phase"], { kind: "ended" }>["outcome"]): PlayerView => ({ ...base, phase: { kind: "ended", outcome } });
  return (
    <>
      <Section id="ext-end-fail" title="End screen: a bust" note="how it ended · ranking marked as a loss · the Rooftop escapee's badge">
        <GameOver view={ended({ result: "failed", reason: "bust", escapees: [ranking[0]!.player], ranking, winners: [ranking[0]!.player] })} />
      </Section>
      <Section id="ext-end-win" title="End screen: success" note="biggest stash wins">
        <GameOver view={ended({ result: "success", ranking, winners: [ranking[0]!.player], getaway: 0 })} />
      </Section>
    </>
  );
}
