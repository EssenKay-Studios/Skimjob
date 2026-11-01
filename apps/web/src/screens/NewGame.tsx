// /new: "Plan a heist": pick the name you host under, then open the lobby
// (POST /auth/guest if needed, then POST /games). Settings are set in the lobby.
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, fetchMe, sentence, type LobbyView, type Me } from "../api";
import { Button } from "../components/Button";
import { ArrowBack, Play } from "../components/icons";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { navigate } from "../router";
import { TopBar } from "./TopBar";

export function NewGame() {
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
      () => setMe(null),
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
      // A different name than the signed-in one hosts as a new guest.
      if (!me || me.name !== nickname) await api("POST", "/auth/guest", { nickname });
      const game = await api<LobbyView>("POST", "/games", {});
      navigate(`/lobby/${game.id}`);
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
          <p className="kicker">New job</p>
          <h1 id="new-title">Plan a heist</h1>
          <p className="form-sheet__lede">You'll host: invite your crew, fill empty seats with bots and pick the rules in the lobby.</p>
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
              Open the lobby
            </Button>
          </form>
        </SketchFrame>
      </main>
    </div>
  );
}
