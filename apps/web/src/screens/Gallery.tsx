// /dev/gallery: every component and token on one page, for eyeballing the
// style against docs/ui-style.md and for screenshots.
import { useCallback, useReducer, useState, type ReactNode } from "react";
import { ChatBadge, ChatPanel, EvidenceCardView } from "../components/Chat";
import { Bubble } from "../components/icons";
import { chatReducer, EMPTY_CHAT, markRead, type ChatMessage, type ChatRequest, type ReadState, type ThreadId } from "../game/chat";
import { Avatar } from "../components/Avatar";
import { BankDoodle } from "../components/BankDoodle";
import { ArtSections, BankSection } from "./GalleryArt";
import { NotesSections } from "./GalleryNotes";
import { RolesGallery } from "./GalleryRoles";
import { HostSection } from "./GalleryHost";
import { PlanDemo } from "./GalleryPlan";
import { RevealSection } from "./GalleryReveal";
import { InfoTipSection } from "./GalleryInfoTip";
import { MarketSection } from "./GalleryMarket";
import { ShellSection } from "./GalleryShell";
import { Button, DangerButton } from "../components/Button";
import { Chip } from "../components/Chip";
import { MyGames } from "../components/MyGames";
import { ArrowBack, Copy, Play, Plus, Star } from "../components/icons";
import { Segmented } from "../components/Segmented";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { Toast, useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { MaskMark, Wordmark } from "../components/Wordmark";
import { CREW_COLOURS } from "../components/avatarLooks";
import { Clock, Lock } from "../components/icons";
import { BANK_JOB } from "@skimjob/content";
import { AlarmBell, WantedStars } from "../components/Bell";
import { CoinBags } from "../components/CoinBags";
import { bagsOf, moveCoin } from "../game/move";
import { Banner, ClockFace, DialogSheet, TallyBars } from "../components/MeetingKit";
import { navigate } from "../router";

const SWATCHES: readonly [string, string][] = [
  ["--paper", "#faf9f5"],
  ["--paper-hi", "#fffdf8"],
  ["--paper2", "#f3ede0"],
  ["--oat", "#e3dacc"],
  ["--manilla", "#ebdbbc"],
  ["--card-sand", "#f1dec4"],
  ["--plinth", "#e8d4b6"],
  ["--ink", "#2a2320"],
  ["--ink2", "#4a403a"],
  ["--mute", "#74695e"],
  ["--clay", "#d97757"],
  ["--clay-hover", "#e08565"],
  ["--clay-d", "#b35a3c"],
  ["--clay-l", "#f4d6c8"],
  ["--kraft", "#d4a27f"],
  ["--olive", "#788c5d"],
  ["--good", "#4f7f34"],
  ["--bad", "#b5443a"],
  ["--sky", "#6a9bcc"],
  ["--gold", "#e2b858"],
  ["--good-l", "#e2ebd2"],
  ["--bad-l", "#f4d5cf"],
  ["--tally-lead", "#f2b640"],
  ["--tally-pass", "#2f6b2a"],
];

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

export function Gallery() {
  const toast = useToast();
  const [speed, setSpeed] = useState(1);
  const [armedCount, setArmedCount] = useState(0);
  const [code, setCode] = useState("");
  const [mole, setMole] = useState<"off" | "maybe" | "on">("maybe");
  return (
    <div className="gallery">
      <header className="topbar">
        <Button variant="back" seed="g-back" icon={<ArrowBack />} onClick={() => navigate("/")}>
          Back <kbd>Esc</kbd>
        </Button>
        <Wordmark size={26} />
      </header>

      <main>
        <SketchFrame as="section" seed="gallery-sheet" radius={24} tape holes className="sheet gallery__sheet enter-sheet">
          <div className="gallery__title">
            <h1>Component gallery</h1>
            <p className="meta">Every building block and illustration, drawn from docs/ui-style.md.</p>
          </div>
          <hr className="dashed" />

          <BankSection />

          <div className="g-grid">
            <ArtSections />

            <Section id="buttons" title="Buttons" note="§5 · hover lifts and tilts, press squashes">
              <div className="g-row">
                <Button variant="primary" seed="g-p1" icon={<Play />}>
                  Lock it in
                </Button>
                <Button variant="primary" seed="g-p2" disabled>
                  Disabled
                </Button>
              </div>
              <div className="g-row">
                <Button variant="secondary" seed="g-s1">
                  Secondary
                </Button>
                <Button variant="secondary" seed="g-s2" icon={<Copy />}>
                  Copy invite link
                </Button>
                <Button variant="secondary" seed="g-s3" disabled>
                  Disabled
                </Button>
              </div>
              <div className="g-row">
                <Button variant="small" seed="g-sm1" icon={<Plus />} aria-label="Add a bot" />
                <Button variant="small" seed="g-sm2">
                  Small
                </Button>
                {[1, 2, 3].map((n) => (
                  <Button key={n} variant="toggle" seed={`g-t${n}`} pressed={speed === n} onClick={() => setSpeed(n)}>
                    {"▶".repeat(n)}
                  </Button>
                ))}
                <Button variant="ghost">Ghost</Button>
              </div>
              <div className="g-row">
                <DangerButton seed="g-d" armedLabel="Really? Click again" onConfirm={() => setArmedCount((n) => n + 1)}>
                  Abandon the job
                </DangerButton>
                <span className="meta">confirmed {armedCount}×</span>
              </div>
              <div className="g-row">
                <Button variant="back" seed="g-b2" icon={<ArrowBack />}>
                  Back <kbd>Esc</kbd>
                </Button>
                <Button variant="back" seed="g-b3" icon={<ArrowBack />} aria-label="Back" className="btn--icon" />
              </div>
            </Section>

            <Section id="segmented" title="Segmented choice" note="host settings, bot picker · busy ignores presses but keeps focus · read-only shows the chosen chip">
              <Segmented
                seed="g-seg"
                label="Saboteur (the dark side)"
                hint="Maybe: you won't know"
                options={[
                  { value: "off", label: "Off" },
                  { value: "maybe", label: "Maybe" },
                  { value: "on", label: "On" },
                ]}
                value={mole}
                onChange={setMole}
              />
              <Segmented
                seed="g-seg-busy"
                label="Busy (saving)"
                hint="Stays focusable, ignores presses"
                options={[
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
                value="on"
                busy
              />
              <Segmented seed="g-seg-ro" label="Read-only (guests)" options={[{ value: mole, label: mole }]} value={mole} readOnly />
            </Section>

            <Section id="premium" title="Premium card" note="§2 dark exception · gold button wiggles now and then">
              <SketchFrame seed="g-pass" radius={16} fill="url(#sk-pass)" ink="var(--pass-line)" shadow={0.55} grain={false} tilt={-0.5} className="pass-card">
                <div className="pass-card__text">
                  <h2 className="pass-card__title">Keep your rap sheet</h2>
                  <p>Premium buttons only ever sit on this dark card.</p>
                </div>
                <Button variant="premium" seed="g-pr" icon={<Star />}>
                  Sign in with Google
                </Button>
              </SketchFrame>
            </Section>

            <Section id="my-games" title="My games" note="M2-12 · signed-in landing · each row is a link back in">
              <MyGames
                seed="g-mygames"
                games={[
                  { id: "g1", status: "running", nickname: "Mara Vox", youAreHost: true, host: "Mara Vox", seats: 6, sessionLength: "1d" },
                  { id: "g2", status: "lobby", nickname: "Dez", youAreHost: false, host: "Lucky Lou", seats: 3, sessionLength: "1h" },
                  { id: "g3", status: "ended", nickname: "Extraordinarily Long Lou", youAreHost: false, host: "Priya K", seats: 12, sessionLength: "1w" },
                ]}
              />
              <MyGames seed="g-mygames-empty" games={[]} />
            </Section>

            <Section id="avatars" title="Blob avatars" note="initials · crew colours · ready / away / turn / bot">
              <div className="g-row g-row--center">
                <Avatar name="Mara Vox" size={46} />
                <Avatar name="Dez" size={40} status="ready" />
                <Avatar name="Lucky Lou" size={40} status="turn" />
                <Avatar name="Priya K" size={40} status="away" />
                <Avatar name="Bot Opportunist" size={40} bot />
                <Avatar name="otto" size={36} />
                <Avatar name="émile" size={28} />
              </div>
              <div className="g-row g-row--center">
                {CREW_COLOURS.map((c, i) => (
                  <Avatar key={c} name={["Ash", "Bo", "Cy", "Di", "Ed", "Fi", "Gus"][i]!} colour={c} size={36} />
                ))}
              </div>
              <div className="g-row g-row--center">
                <span className="avatar-stack">
                  {["Mara Vox", "Dez", "Lucky Lou", "Priya K", "Otto", "Sam"].map((n) => (
                    <Avatar key={n} name={n} size={34} />
                  ))}
                </span>
                <span className="meta">avatar stack</span>
              </div>
            </Section>

            <Section id="frames" title="Sketch frames" note="§4 · seeded wobble, hatched shadow, grain, tape, holes, boil">
              <div className="g-frames">
                <SketchFrame seed="f1" className="g-frame">
                  <b className="hand">seed f1</b>
                  <span className="meta">default card</span>
                </SketchFrame>
                <SketchFrame seed="f2" className="g-frame">
                  <b className="hand">seed f2</b>
                  <span className="meta">same size, new wobble</span>
                </SketchFrame>
                <SketchFrame seed="f3" fill="var(--manilla)" className="g-frame" tilt={-1}>
                  <b className="hand">manilla</b>
                  <span className="meta">case-file fill, tilted</span>
                </SketchFrame>
                <SketchFrame seed="f4" boil ink="var(--clay-d)" className="g-frame">
                  <b className="hand">boiling</b>
                  <span className="meta">hot / alert elements</span>
                </SketchFrame>
                <SketchFrame seed="f5" tape className="g-frame">
                  <b className="hand">taped</b>
                  <span className="meta">sheet furniture</span>
                </SketchFrame>
                <SketchFrame seed="f6" fill="var(--clay-l)" shadow={0} className="g-frame">
                  <b className="hand">no shadow</b>
                  <span className="meta">selected tint</span>
                </SketchFrame>
              </div>
            </Section>

            <Section id="type" title="Type" note="§3 · Pangolin headings, Inter body">
              <div className="g-type">
                <h1>Page title 32</h1>
                <h2>Section heading 21</h2>
                <h3>
                  <Underline seed="t">Panel heading 17</Underline>
                </h3>
                <p>Body copy in Inter 14.5/1.45. Pick a room, loot it, then decide how much reaches the duffel.</p>
                <p className="meta">Caption · Inter 600 12 · muted</p>
                <p>
                  <span className="num g-money">$ 48,200</span> <span className="meta">tabular numbers</span> <kbd>Esc</kbd> <kbd>Ctrl</kbd>{" "}
                  <kbd>1</kbd>
                </p>
                <div className="g-row g-row--center">
                  <Wordmark size={40} />
                  <MaskMark size={40} />
                </div>
              </div>
            </Section>

            <Section id="inputs" title="Chips, fields, toasts" note="§4 chips · §8 toasts">
              <div className="g-row">
                <Chip colour="var(--sky)">Sky</Chip>
                <Chip colour="var(--olive)">Olive</Chip>
                <Chip colour="var(--gold)">Gold</Chip>
                <Chip on>Active</Chip>
              </div>
              <div className="g-fields">
                <TextField seed="g-f1" label="Nickname" placeholder="Lucky Lou" hint="Shown to your crew." value={code} onChange={(e) => setCode(e.target.value)} />
                <TextField seed="g-f2" label="Invite code" defaultValue="nope!" error="That doesn't look like an invite code." />
              </div>
              <div className="g-col">
                <Toast text="Dez locked in a move." tone="good" seed="g-toast1" />
                <Toast text="Raid! The Vault is taped off. Wanted 2." tone="bad" seed="g-toast2" />
                <Toast text="Meeting at 8 pm tonight." seed="g-toast3" />
              </div>
              <div className="g-row">
                <Button variant="secondary" seed="g-pop" onClick={() => toast("A fresh toast pops in.", "good")}>
                  Pop a toast
                </Button>
              </div>
            </Section>

            <Section id="palette" title="Palette" note="§2 tokens">
              <div className="g-swatches">
                {SWATCHES.map(([name, hex]) => (
                  <div key={name} className="g-swatch">
                    <span className="g-swatch__chip" style={{ background: `var(${name})` }} />
                    <code>{name}</code>
                    <span className="meta">{hex}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="art" title="Landing hero" note="M2-9 cutaway at dusk, labels off">
              <SketchFrame seed="g-art" radius={18} fill="var(--card-sand)" shadow={0.5} className="hero-card">
                <BankDoodle className="hero-card__img" />
              </SketchFrame>
            </Section>

            <Section id="chat" title="Chat" note="M2-8b · crew + DMs, DM notices, evidence cards, limits">
              <ChatSamples />
            </Section>

            <NotesSections />

            <Section id="plan" title="Plan board" note="S4.3 · tap a head, then a room, or tap a room to claim it · claims, pledge, I agree · last round's plan with its history, and an alibi">
              <PlanDemo />
            </Section>

            <RevealSection />

            <Section id="meet" title="Meetings kit" note="M2-7 · clock face, tally bars, result banners, vote dialog sheet">
              <MeetingKitSamples />
            </Section>

            <RolesGallery />

            <HostSection />

            <ShellSection />
            <InfoTipSection />

            <Section id="game" title="Game kit" note="M2-6, S4.1, S4.2 · coins and the two bags, alarm bells, Wanted stars">
              <GameKitSamples />
            </Section>
            <MarketSection />
          </div>
        </SketchFrame>
      </main>
    </div>
  );
}

/** The game screen's building blocks (M2-6, S4.2), live. */
function GameKitSamples() {
  const { bulbs, bustStars } = BANK_JOB.alarm;
  const [grab, setGrab] = useState(3);
  const [pocket, setPocket] = useState(1);
  const bags = bagsOf(grab, pocket);
  return (
    <>
      <CoinBags
        limit={3}
        grab={grab}
        bags={bags}
        onGrab={setGrab}
        onMove={(bag) => setPocket(moveCoin(bags, bag).pocket)}
        bell={<AlarmBell bulbs={bulbs} lit={2} preview={1} />}
      />
      <div className="g-row g-row--center">
        <AlarmBell bulbs={bulbs} lit={0} />
        <AlarmBell bulbs={bulbs} lit={2} />
        <AlarmBell bulbs={bulbs} lit={bulbs - 1} />
        <AlarmBell bulbs={bulbs} lit={1} preview={2} />
        <AlarmBell bulbs={bulbs} lit={0} hidden />
        <AlarmBell bulbs={bulbs} lit={2} size="xs" />
        <span className="meta">empty · 2 lit · one from a raid · your grab would add 2 (dashed) · hidden by the Hacker · narrow rooms</span>
      </div>
      <div className="g-row g-row--center">
        {Array.from({ length: bustStars + 1 }, (_, n) => (
          <WantedStars key={n} stars={n} max={bustStars} />
        ))}
        <span className="meta">Wanted 0 to the bust line</span>
        <span className="g-icon">
          <Clock />
        </span>
        <span className="g-icon">
          <Lock />
        </span>
      </div>
    </>
  );
}

/** The meetings and voting building blocks (M2-7), live. */
function MeetingKitSamples() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="g-row g-row--center">
        {[42_000, 5 * 60_000 + 12_000, 29 * 60_000].map((ms) => (
          <ClockFace key={ms} ms={ms} />
        ))}
        <span className="meta">0:42 / 5:12 / 29:00 left</span>
      </div>
      <TallyBars
        label="Sample tally"
        rows={[
          { key: "a", label: "Dez", votes: 3, share: 1, passed: true },
          { key: "b", label: "Mo", votes: 2, share: 2 / 3 },
          { key: "skip", label: "Skip", votes: 1, share: 1 / 3 },
        ]}
      />
      <TallyBars
        label="Sample live tally"
        rows={[
          { key: "a", label: "Ana", votes: 2, share: 1, leading: true },
          { key: "skip", label: "Skip", votes: 1, share: 0.5 },
        ]}
      />
      <Banner tone="good" seed="g-b1" title="Caught! Dez was holding 11.">
        11 set aside for the next split.
      </Banner>
      <Banner tone="bad" seed="g-b2" title="Clean! Mo was holding 2.">
        Nothing above the share: nothing taken.
      </Banner>
      <Banner seed="g-b3" title="A shakedown fell through.">
        Nobody's stash was opened.
      </Banner>
      <Button variant="secondary" seed="g-dialog" onClick={() => setOpen(true)}>
        Open the dialog sheet
      </Button>
      <DialogSheet open={open} onClose={() => setOpen(false)} seed="g-dialog-sheet" labelledBy="g-dialog-h">
        <p className="kicker">Meeting 1</p>
        <h2 id="g-dialog-h">Who's skimming?</h2>
        <p>The vote window opens in this sheet. Esc, the backdrop or the button closes it.</p>
        <Button variant="primary" seed="g-dialog-close" onClick={() => setOpen(false)}>
          Close
        </Button>
      </DialogSheet>
    </>
  );
}

const G_PEOPLE = [
  { id: "me", name: "You", isBot: false },
  { id: "dez", name: "Dez", isBot: false },
  { id: "lou", name: "Lucky Lou", isBot: false },
  { id: "bot", name: "Bot · Rex", isBot: true },
];
const gAt = (min: number) => new Date(Date.UTC(2026, 10, 2, 18, min)).toISOString();
const G_SIGHTING = { type: "roomSighting", payload: { player: "dez", round: 2, room: "vault", others: ["lou"] } };
const G_HISTORY: ChatMessage[] = [
  { id: "g1", from: "dez", to: null, at: gAt(1), verified: false, text: "Who went to the Vault in round 2? The duffel came up short." },
  { id: "g2", from: "lou", to: null, at: gAt(2), verified: false, text: "Not me. <b>Promise</b> **really**. Supercalifragilisticexpialidociousvaultdoorsquad" },
  { id: "g3", from: "dez", to: null, at: gAt(3), verified: true, card: G_SIGHTING },
  { id: "g4", from: "lou", to: "me", at: gAt(4), verified: false, text: "Back me up at the meeting?" },
];

/** The chat panel (M2-8b) with sample talk; sending works locally. */
function ChatSamples() {
  const [chat, dispatch] = useReducer(chatReducer, EMPTY_CHAT, (s) =>
    chatReducer(s, { type: "history", history: { messages: G_HISTORY, dmNotices: [{ from: "dez", to: "lou", at: gAt(5) }] } }),
  );
  const [read, setRead] = useState<ReadState>({});
  const onRead = useCallback((t: ThreadId, at: string) => setRead((r) => markRead(r, t, at)), []);
  const send = async (req: ChatRequest) => {
    const base = { id: `local-${Date.now()}`, from: "me", to: req.to, at: new Date().toISOString() };
    dispatch({ type: "message", message: "text" in req ? { ...base, verified: false, text: req.text } : { ...base, verified: true, card: G_SIGHTING } });
    return { ok: true } as const;
  };
  return (
    <div className="g-chat">
      <ChatPanel
        me="me"
        people={G_PEOPLE}
        chat={chat}
        read={read}
        onRead={onRead}
        send={send}
        connection="open"
        evidence={[{ seq: 1, text: "Round 2, Vault: Dez saw Lucky Lou there too." }]}
        events={[{ key: "g-ev", at: gAt(6), text: "Round 2: 13 taken, 4 went missing, 51 coins left in the bank." }]}
        visible
        className="g-chat__panel"
      />
      <div className="g-col">
        <EvidenceCardView card={G_SIGHTING} from="dez" ctx={{ me: "me", name: (p) => G_PEOPLE.find((x) => x.id === p)?.name ?? p }} seed="g-ev-card" />
        <div className="g-row">
          <Button variant="primary" seed="g-chat-fab" icon={<Bubble />} aria-label="Open chat, 3 unread">
            <span className="g-fab-label">
              Chat <ChatBadge count={3} />
            </span>
          </Button>
          <span className="meta">The phone / tablet open-chat button</span>
        </div>
      </div>
    </div>
  );
}
