// /lobby/:id: seats (people and clearly marked bots), the invite link, host
// settings, bots, hand-over and start. Polls GET /games/:id every 2 s; when the
// game starts every seated browser moves to /game/:id. design §15, §16
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, inviteLink, sentence, type LobbySettings, type LobbyView, type Seat } from "../api";
import { Avatar } from "../components/Avatar";
import { Button, DangerButton } from "../components/Button";
import { Chip } from "../components/Chip";
import { Copy, Play, Plus } from "../components/icons";
import { Segmented, type SegmentedOption } from "../components/Segmented";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { ToastIcon, useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { navigate } from "../router";
import { TopBar } from "./TopBar";

const POLL_MS = 2000;
/** While the server can't be reached, polls back off (2 s, 4 s, 8 s … up to this). */
const POLL_MAX_MS = 16000;

const onOff: readonly SegmentedOption<boolean>[] = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];

/** Host settings in the order shown. Labels are the client's; values are the server's (settings.ts). */
const SETTINGS = [
  {
    key: "sessionLength",
    label: "Session length",
    options: [
      { value: "quick", label: "Quick 15 min" },
      { value: "1h", label: "1 hour" },
      { value: "3h", label: "3 hours" },
      { value: "1d", label: "1 day" },
      { value: "3d", label: "3 days" },
      { value: "1w", label: "1 week" },
    ],
  },
  {
    key: "voteVisibility",
    label: "Votes",
    options: [
      { value: "hiddenThenRevealed", label: "Hidden, then shown" },
      { value: "open", label: "Open" },
      { value: "secret", label: "Secret" },
    ],
  },
  {
    key: "mole",
    label: "Saboteur (the dark side)",
    hint: "Maybe: you won't know if one was dealt",
    options: [
      { value: "off", label: "Off" },
      { value: "maybe", label: "Maybe" },
      { value: "on", label: "On" },
    ],
  },
  { key: "uniqueRoles", label: "Unique roles", hint: "Each role at most once", options: onOff },
  { key: "eventsEnabled", label: "Bank events", options: onOff },
  { key: "starterMode", label: "Starter mode", hint: "Simple roles; no saboteur, no events", options: onOff },
  { key: "dmNotices", label: "DM notices", hint: "Everyone sees that a DM was sent", options: onOff },
] as const satisfies readonly { key: keyof LobbySettings; label: string; hint?: string; options: readonly SegmentedOption<string | boolean>[] }[];

/** One change, plus what starter mode needs to stay valid (the server refuses the mix). */
function settingsPatch(current: LobbySettings, key: keyof LobbySettings, value: string | boolean): Partial<LobbySettings> {
  if (key === "starterMode" && value === true) return { starterMode: true, mole: "off", eventsEnabled: false };
  if (current.starterMode && ((key === "mole" && value !== "off") || (key === "eventsEnabled" && value === true))) return { [key]: value, starterMode: false };
  return { [key]: value };
}

const BLURBS: Record<string, string> = {
  honest: "hands in nearly everything",
  opportunist: "skims when nobody's looking",
  greedy: "pockets big, lies often",
  cautious: "lays low, suspects fast",
  random: "rolls dice for everything",
};

export function Lobby({ id }: { id: string }) {
  const toast = useToast();
  const [game, setGame] = useState<LobbyView | null>(null);
  const [missing, setMissing] = useState(false);
  const [personality, setPersonality] = useState("opportunist");
  const [busyAct, setBusy] = useState(false);
  // Responses are applied in request order, so a slow poll never undoes a newer change.
  const seq = useRef(0);
  const applied = useRef(0);
  const apply = useCallback((n: number, view: LobbyView) => {
    if (n < applied.current) return;
    applied.current = n;
    setGame(view);
  }, []);

  // One persistent banner while the server can't be reached (no toast per poll), cleared on recovery.
  const [offline, setOffline] = useState(false);
  const failed = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.unreachable) setOffline(true);
      else if (err instanceof ApiError && (err.status === 404 || err.status === 401)) setMissing(true);
      else toast(err instanceof ApiError ? sentence(err.message) : "Something went wrong.", "bad");
    },
    [toast],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    const n = ++seq.current;
    try {
      apply(n, await api<LobbyView>("GET", `/games/${id}`));
      setOffline(false);
      return true;
    } catch (err) {
      failed(err);
      return !(err instanceof ApiError && err.unreachable);
    }
  }, [id, apply, failed]);

  // One poll loop at a time (QA PR #27: an "online" event mid-poll used to start a second loop).
  useEffect(() => {
    let stop = false;
    let running = false;
    let again = false; // "online" arrived mid-poll: poll again at once when it ends
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MS;
    const loop = async () => {
      if (running || stop) return;
      running = true;
      clearTimeout(timer);
      const ok = await refresh();
      running = false;
      if (stop) return;
      delay = ok ? POLL_MS : Math.min(delay * 2, POLL_MAX_MS);
      if (again) {
        again = false;
        void loop();
      } else timer = setTimeout(() => void loop(), delay);
    };
    void loop();
    // Coming back online: check at once instead of waiting out the back-off.
    const online = () => {
      delay = POLL_MS;
      if (running) again = true;
      else void loop();
    };
    window.addEventListener("online", online);
    return () => {
      stop = true;
      clearTimeout(timer);
      window.removeEventListener("online", online);
    };
  }, [refresh]);

  useEffect(() => {
    if (game && game.status !== "lobby") navigate(`/game/${game.id}`);
  }, [game]);

  /** Runs a host action that answers with the new lobby view. */
  const act = async (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown, optimistic?: LobbyView) => {
    const n = ++seq.current;
    if (optimistic) apply(n, optimistic);
    setBusy(true);
    try {
      apply(n, await api<LobbyView>(method, path, body));
      return true;
    } catch (err) {
      failed(err);
      // An optimistic change that didn't reach the server must not look saved (PR #27 review).
      if (optimistic && err instanceof ApiError && err.unreachable) toast("That change wasn't saved: can't reach the hideout.", "bad");
      void refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const banner = offline && (
          <SketchFrame seed="offline" radius={14} shadow={0.35} grain={false} fill="var(--clay-l)" className="offline-banner" role="status">
            <ToastIcon tone="bad" />
            <span>
              <b>Can't reach the hideout.</b> Retrying… your seat is safe.
            </span>
          </SketchFrame>
  );

  if (missing) {
    return (
      <div className="page">
        <TopBar />
        <main>
          <SketchFrame seed="lobby-missing" radius={20} tape className="sheet form-sheet enter-sheet">
            <h1>No crew here.</h1>
            <p className="form-sheet__lede">This lobby doesn't exist, or you're not in it any more.</p>
            <Button variant="primary" seed="lobby-home" onClick={() => navigate("/")}>
              Back to the start
            </Button>
          </SketchFrame>
        </main>
      </div>
    );
  }
  if (!game) {
    return (
      <div className="page">
        <TopBar />
        <main>
          {banner}
          <p className="meta lobby__loading">{offline ? "Waiting for the hideout to answer…" : "Opening the lobby…"}</p>
        </main>
      </div>
    );
  }

  // While the server can't be reached, nothing can be changed (it would only revert).
  const busy = busyAct || offline;
  const host = game.seats.find((s) => s.host);
  const full = game.seats.length >= game.maxSeats;
  const canStart = game.seats.length >= game.minSeats;
  const link = inviteLink(game.inviteCode);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied. Send it to your crew.", "good");
    } catch {
      (document.getElementById("invite-link") as HTMLInputElement | null)?.select();
      toast("Copy the selected link by hand.");
    }
  };

  const changeSetting = (key: keyof LobbySettings, value: string | boolean) => {
    const patch = settingsPatch(game.settings, key, value);
    void act("PATCH", `/games/${id}/settings`, { settings: patch }, { ...game, settings: { ...game.settings, ...patch } });
  };

  const leave = async () => {
    try {
      await api("POST", `/games/${id}/leave`);
      toast("You left the crew.");
      navigate("/");
    } catch (err) {
      failed(err);
    }
  };

  return (
    <div className="page lobby">
      <TopBar>
        {!game.youAreHost && (
          <DangerButton seed="leave" onConfirm={() => void leave()} armedLabel="Leave? Tap again">
            Leave crew
          </DangerButton>
        )}
      </TopBar>
      <main>
        {banner}
        <SketchFrame as="section" seed="lobby-sheet" radius={24} tape holes className="sheet lobby__sheet enter-sheet" aria-labelledby="lobby-title">
          <header className="lobby__head">
            <p className="kicker">Lobby · First National</p>
            <h1 id="lobby-title">Assemble the crew</h1>
            <p className="meta">
              <span className="num">{game.seats.length}</span> of <span className="num">{game.maxSeats}</span> seats ·{" "}
              {game.youAreHost ? "you're the host" : `${host?.nickname ?? "the host"} is hosting`}
            </p>
          </header>
          <hr className="dashed" />

          <div className="lobby__grid">
            <section className="lobby__crew" aria-labelledby="crew-title">
              <h2 id="crew-title">
                <Underline seed="crew">The crew</Underline>
              </h2>
              <ul className="seats">
                {game.seats.map((s) => (
                  <SeatRow key={s.seat} s={s} game={game} busy={busy} act={act} personalityName={game.personalities.find((p) => p.id === s.bot)?.name} />
                ))}
              </ul>

              {game.youAreHost && (
                <SketchFrame seed="add-bot" radius={14} shadow={0.35} fill="var(--paper2)" className="addbot">
                  <Segmented
                    seed="bot-kind"
                    label="Add a bot"
                    hint={BLURBS[personality]}
                    options={game.personalities.map((p) => ({ value: p.id, label: p.name }))}
                    value={personality}
                    onChange={setPersonality}
                  />
                  <Button
                    variant="secondary"
                    seed="add-bot-btn"
                    icon={<Plus />}
                    disabled={busy || full}
                    onClick={() => void act("POST", `/games/${id}/bots`, { personality })}
                  >
                    {full ? "Crew is full" : "Add bot"}
                  </Button>
                </SketchFrame>
              )}
            </section>

            <aside className="lobby__side">
              <SketchFrame seed="invite-card" radius={16} shadow={0.45} fill="var(--manilla)" tilt={-0.5} className="invite-card">
                <h2>
                  <Underline seed="inv">Invite your crew</Underline>
                </h2>
                <TextField
                  id="invite-link"
                  seed="invite-link"
                  label="Invite link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  hint={
                    <>
                      Code <b className="num">{game.inviteCode}</b> · works until the job starts
                    </>
                  }
                />
                <Button variant="secondary" seed="copy-link" icon={<Copy />} onClick={() => void copy()}>
                  Copy invite link
                </Button>
              </SketchFrame>

              <section className="settings" aria-labelledby="settings-title">
                <h2 id="settings-title">
                  <Underline seed="rules">House rules</Underline>
                </h2>
                {!game.youAreHost && <p className="meta">Only the host can change these.</p>}
                <div className="settings__list">
                {SETTINGS.map((def) => (
                  <Segmented<string | boolean>
                    key={def.key}
                    seed={`set-${def.key}`}
                    label={def.label}
                    hint={"hint" in def ? def.hint : undefined}
                    options={def.options}
                    value={game.settings[def.key]}
                    readOnly={!game.youAreHost}
                    disabled={busy}
                    onChange={(v) => changeSetting(def.key, v)}
                    wide={def.options.length > 2}
                  />
                ))}
                </div>
              </section>
            </aside>
          </div>

          <hr className="dashed" />
          <footer className="lobby__start">
            {game.youAreHost ? (
              <>
                <Button
                  variant="primary"
                  seed="start-job"
                  icon={<Play />}
                  className="lobby__start-btn"
                  disabled={busy || !canStart}
                  onClick={() => void act("POST", `/games/${id}/start`)}
                >
                  Start the job
                </Button>
                <p className="meta">
                  {canStart
                    ? "Once you start, nobody new can join. To leave, make someone else host first."
                    : `You need at least ${game.minSeats} seats: invite a friend or add a bot.`}
                </p>
              </>
            ) : (
              <p className="lobby__wait">
                <span className="hand">Waiting for {host?.nickname ?? "the host"} to start the job…</span>
              </p>
            )}
          </footer>
        </SketchFrame>
      </main>
    </div>
  );
}

function SeatRow({
  s,
  game,
  busy,
  act,
  personalityName,
}: {
  s: Seat;
  game: LobbyView;
  busy: boolean;
  act: (method: "POST" | "DELETE", path: string, body?: unknown) => Promise<boolean>;
  personalityName: string | undefined;
}) {
  const toast = useToast();
  return (
    <li className={s.bot ? "seat seat--bot" : "seat"}>
      <Avatar name={s.bot ? s.nickname.replace(/^Bot · /, "") : s.nickname} size={40} bot={!!s.bot} />
      <div className="seat__who">
        <span className="seat__name">{s.nickname}</span>
        <span className="seat__tags">
          {s.host && <Chip colour="var(--gold)">Host</Chip>}
          {s.you && <Chip colour="var(--clay)">You</Chip>}
          {s.bot && <Chip colour="var(--sky)">Bot · {personalityName ?? s.bot}</Chip>}
        </span>
      </div>
      {game.youAreHost && s.bot && (
        <Button variant="small" seed={`rm-${s.seat}`} disabled={busy} aria-label={`Remove ${s.nickname}`} onClick={() => void act("DELETE", `/games/${game.id}/bots/${s.seat}`)}>
          Remove
        </Button>
      )}
      {game.youAreHost && !s.bot && !s.you && (
        <DangerButton
          seed={`host-${s.seat}`}
          disabled={busy}
          armedLabel="Hand over?"
          aria-label={`Make ${s.nickname} host`}
          onConfirm={() =>
            void act("POST", `/games/${game.id}/host`, { seat: s.seat }).then((ok) => ok && toast(`${s.nickname} is the host now. You can leave or stay.`, "good"))
          }
        >
          Make host
        </DangerButton>
      )}
    </li>
  );
}
