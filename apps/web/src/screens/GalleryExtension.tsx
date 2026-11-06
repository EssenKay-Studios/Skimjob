// /dev/gallery sections for the Extension UI (docs/extension.md): role facts
// and tappable role names, the rulebook, the target bar and Heat breakdown,
// the gap box, a live shop on a local engine game, the no-tells feed lines,
// the lobby deck settings and the end screen. No server: a local engine game.
import { useMemo, useState, type ReactNode } from "react";
import { DECKS, POLICE_ACTIVITY, type RoleId } from "@skimjob/content";
import {
  PUBLIC,
  applyEvent,
  createGame,
  handleCommand,
  privateTo,
  viewFor,
  type GameConfig,
  type GameState,
  type PlayerView,
  type SystemCommand,
} from "@skimjob/engine";
import type { LobbySettings } from "../api";
import { Button } from "../components/Button";
import { DeckSettings } from "../components/DeckSettings";
import { GapBox, HeatBreakdown, PerkUses, RoleFacts, RoleList, RoleTip, RulebookButton, TargetBar, Tokens } from "../components/Extension";
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
  rolePool: ["lookout", "auditor", "detective", "smoothTalker"],
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
  uniqueRoles: true,
  ...extra,
});
const round = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "round", round: r } });
const alibis = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "alibis", round: r } });
const step = (s: GameState, c: Parameters<typeof handleCommand>[1]) => {
  const r = handleCommand(s, c);
  return r.ok ? r.state : s;
};

/** Rounds 1–3 played with default moves, police activity in round 2, then meeting 1 closes (a missed target). */
function playedGame(): GameState {
  let s = createGame(config({ eventsEnabled: false }));
  for (let r = 1; r <= 3; r++) {
    s = step(s, round(r));
    if (r === 1) s = step(s, { type: "postAlibi", player: "p2", room: "vault" });
    if (r === 2) s = applyEvent(s, { type: "policeActivity", visibility: PUBLIC, round: 2, heatAdded: POLICE_ACTIVITY.heat, heat: s.heat + POLICE_ACTIVITY.heat });
    s = step(s, alibis(r));
  }
  s = step(s, { type: "scheduleMeeting", player: "p1", act: 1, slot: "now" });
  s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
  s = step(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } });
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
      <ShopSection />
      <HudSections />
      <NoTellsSection />
      <DeckSection />
      <EndSection />
    </>
  );
}

function RoleSections() {
  const game = useLocalGame(() => createGame(config()));
  const sample: RoleId[] = ["rookie", "lookout", "hacker", "mole", "fixer"];
  return (
    <>
      <Section id="ext-role-card" title="Role card" note="extension.md Roles · tag, power, token trigger, How you win, tokens, role list, rulebook">
        <RoleCard view={game.view} send={game.send} />
      </Section>
      <Section id="ext-roles" title="Role facts and role names" note="every role card carries a tag and a How you win line · tap a name for its tag and win line">
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
      <Section id="ext-rulebook" title="Rulebook sheet" note="game in a minute, Endings table, roles by tag with ★, the shop · numbers from content">
        <div className="g-row">
          <RulebookButton view={null} seed="g-rulebook-content" />
          <RulebookButton view={game.view} seed="g-rulebook-game" />
        </div>
        <p className="meta">Left: outside a game (all perks by column). Right: this game's role list and three-perk shop.</p>
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

/** The live shop: earn tokens (gallery only), buy, use one perk per round, next round. */
function ShopSection() {
  const game = useLocalGame(() => ({ ...createGame(config()), shop: ["peek", "shield", "rig"] }));
  const { state, setState, view, send } = game;
  const earn = () => setState(applyEvent(state, { type: "tokenEarned", visibility: privateTo("p1"), player: "p1", trigger: "checkpointMade" }));
  const next = () => setState(step(step(state, round(state.round)), alibis(state.round)));
  return (
    <Section id="ext-shop" title="Tokens and the shop" note="extension.md Tokens and the perk shop · live local game: buy, own privately, one use per round">
      <div className="g-stack" data-testid="shop-demo">
        <p className="meta">
          Round <b className="num">{view.round}</b> · {view.phase.kind}
        </p>
        <div className="g-row">
          <Button variant="small" seed="g-earn" onClick={earn}>
            Earn a token
          </Button>
          <Button variant="small" seed="g-next" onClick={next}>
            Next round
          </Button>
        </div>
        <SketchFrame seed="g-tokens" radius={14} fill="var(--card-sand)" className="panel">
          <Tokens view={view} send={send} />
          <PerkUses view={view} send={send} />
        </SketchFrame>
      </div>
    </Section>
  );
}

function HudSections() {
  const played = useMemo(() => viewFor(playedGame(), "p1"), []);
  const fresh = useMemo(() => viewFor(createGame(config()), "p1"), []);
  const gap = (g: PlayerView["gap"]): PlayerView => ({ ...played, gap: g });
  return (
    <>
      <Section id="ext-target" title="Haul target bar" note="Haul X / Y needed by the next meeting · what missing it costs">
        <div className="g-stack">
          <TargetBar view={fresh} />
          <TargetBar view={{ ...fresh, haul: 40 }} />
          <TargetBar view={{ ...fresh, haul: 40, act: 3 }} />
        </div>
      </Section>
      <Section id="ext-heat" title="Heat breakdown" note="per round: every round, rooms, police activity, missed target · newest first">
        <HeatBreakdown view={played} />
      </Section>
      <Section id="ext-gap" title="Gap box" note="alibis vs the Haul's growth, event effects included">
        <div className="g-stack">
          <GapBox view={gap({ round: 4, posted: 0, alibis: 0, haulGrowth: 9, unaccounted: -9 })} />
          <GapBox view={gap({ round: 4, posted: 3, alibis: 14, haulGrowth: 9, unaccounted: 5 })} />
          <GapBox view={gap({ round: 4, posted: 4, alibis: 9, haulGrowth: 9, unaccounted: 0 })} />
          <GapBox view={gap({ round: 4, posted: 2, alibis: 6, haulGrowth: 9, unaccounted: -3 })} />
        </div>
      </Section>
    </>
  );
}

/** extension.md Situations: a Mole's tip-off reads like police activity. */
function NoTellsSection() {
  const ctx = { me: "p1", name: (p: string) => NAMES[Number(p.slice(1)) - 1] ?? p };
  const feed = { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 4, source: "security", room: "vault", seen: [], offline: true } as const;
  const police = { type: "policeActivity", visibility: PUBLIC, round: 5, heatAdded: POLICE_ACTIVITY.heat, heat: 41 } as const;
  return (
    <Section id="ext-notells" title="Camera offline and police activity" note="the same line whatever caused it: no tells">
      <dl className="g-stack">
        <dt className="meta">Hacker's loop</dt>
        <dd>{describeEvent(feed, ctx)}</dd>
        <dt className="meta">Mole's tip-off</dt>
        <dd>{describeEvent(police, ctx)}</dd>
        <dt className="meta">Random police activity</dt>
        <dd>{describeEvent(police, ctx)}</dd>
      </dl>
    </Section>
  );
}

const LOBBY: LobbySettings = {
  sessionLength: "1h",
  voteVisibility: "hiddenThenRevealed",
  deck: "standard",
  roles: [],
  deal: "balanced",
  roleList: "exact",
  eventsEnabled: true,
  dmNotices: true,
  uniqueRoles: true,
};

function DeckSection() {
  const [s, setS] = useState(LOBBY);
  return (
    <Section id="ext-deck" title="Lobby: deck, deal, role list" note="extension.md Host settings · Starter, Standard, Everything, roles one by one">
      <div className="g-stack">
        <div className="settings__list">
          <DeckSettings settings={s} readOnly={false} disabled={false} onChange={(p) => setS({ ...s, ...p })} />
        </div>
        <hr className="dashed" />
        <p className="meta">Guest view (read-only), custom pick:</p>
        <div className="settings__list">
          <DeckSettings settings={{ ...LOBBY, roles: DECKS.standard.filter((r) => r !== "mole") }} readOnly disabled={false} onChange={() => {}} />
        </div>
      </div>
    </Section>
  );
}

function EndSection() {
  const base = useMemo(() => viewFor(playedGame(), "p1"), []);
  const ranking = base.players.map((p, i) => ({ player: p.id, role: (["hacker", "rookie", "lookout", "mole"] as const)[i]!, score: 30 - i * 6, stash: 30 - i * 6, timesShakenDown: 0, totalHandedIn: 10 }));
  const ended = (outcome: Extract<PlayerView["phase"], { kind: "ended" }>["outcome"]): PlayerView => ({ ...base, phase: { kind: "ended", outcome } });
  return (
    <>
      <Section id="ext-end-fail" title="End screen: a raid" note="how it ended · ranking marked as a loss · the winner's reason badge">
        <GameOver view={ended({ result: "failed", reason: "heat", ranking, winners: [ranking[0]!.player] })} />
      </Section>
      <Section id="ext-end-win" title="End screen: success" note="biggest stash wins">
        <GameOver view={ended({ result: "success", ranking, winners: [ranking[0]!.player] })} />
      </Section>
    </>
  );
}
