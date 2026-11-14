// /new: "Plan a heist": pick the name you host under, then open the lobby
// (POST /auth/guest if needed, then POST /games). Settings are set in the lobby.
// /learn: "Learn the game" (design §14): the same form, then POST /games/learn
// starts a single-player guided game with bots and opens it.
import { useEffect, useState, type FormEvent } from "react";
import { LEARN_SEATS } from "@skimjob/content";
import { api, ApiError, fetchMe, sentence, type LobbyView, type Me } from "../api";
import { Button } from "../components/Button";
import { ArrowBack, Play } from "../components/icons";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { navigate } from "../router";
import { TopBar } from "./TopBar";

const MODES = {
  host: {
    kicker: "New job",
    title: "Plan a heist",
    lede: "You'll host: invite your crew, fill empty seats with bots and pick the rules in the lobby.",
    submit: "Open the lobby",
    create: "/games",
    open: (id: string) => `/lobby/${id}`,
  },
  learn: {
    kicker: "Single player",
    title: "Learn the game",
    lede: `A short guided job: you and ${LEARN_SEATS - 1} bots, about 5 minutes. A pop-up explains each step as you play.`,
    submit: "Start the lesson",
    create: "/games/learn",
    open: (id: string) => `/game/${id}`,
  },
} as const;

export function NewGame({ mode = "host" }: { mode?: keyof typeof MODES }) {
  const m = MODES[mode];
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  useEffect(() => {
    fetchMe().then(
      (u) => {
        setMe(u);
        if (u) setName((n) => n || u.name);
      },
      () => setMe(null), // can't tell yet; submit asks again
    );
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nickname = name.trim();
    if (!nickname) {
      setError("Pick a name your crew will see.");
      setShake((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      // Sign in as a guest only when there's no session. A signed-in player keeps it (and
      // their other games); the name is just their seat name in this game (PR #27 review).
      // Asked again here, so a failed check on load can never sign a player out.
      const current = await fetchMe();
      if (!current) await api("POST", "/auth/guest", { nickname });
      const game = await api<LobbyView>("POST", m.create, { nickname });
      navigate(m.open(game.id));
    } catch (err) {
      setError(err instanceof ApiError ? sentence(err.message) : "Something went wrong. Try again.");
      setShake((n) => n + 1);
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <TopBar>
        <Button variant="back" seed="new-back" icon={<ArrowBack />} onClick={() => navigate("/")}>
          Back <kbd>Esc</kbd>
        </Button>
      </TopBar>
      <main>
        <SketchFrame as="section" seed="new-sheet" radius={22} tape holes className="sheet form-sheet enter-sheet" aria-labelledby="new-title">
          <p className="kicker">{m.kicker}</p>
          <h1 id="new-title">{m.title}</h1>
          <p className="form-sheet__lede">{m.lede}</p>
          <hr className="dashed" />
          <form className="form-sheet__form" onSubmit={submit} noValidate>
            <TextField
              seed="host-name"
              label="Your name in this game"
              placeholder="e.g. Mara"
              autoComplete="nickname"
              maxLength={24}
              value={name}
              shake={shake}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              {...(error ? { error } : { hint: "1–24 characters. Names starting with “Bot” are for bots." })}
            />
            <Button type="submit" variant="primary" seed="open-lobby" icon={<Play />} block disabled={busy || me === undefined}>
              {m.submit}
            </Button>
          </form>
        </SketchFrame>
      </main>
    </div>
  );
}
