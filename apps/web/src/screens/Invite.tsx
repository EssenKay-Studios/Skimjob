// /join/:code: the invite page. Shows whose crew it is, asks for a nickname,
// joins (POST /invites/:code/join signs a guest in), then opens the lobby.
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, sentence, type InvitePreview, type LobbyView } from "../api";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { ArrowBack, Play } from "../components/icons";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { Underline } from "../components/Underline";
import { navigate } from "../router";
import { TopBar } from "./TopBar";

type Load = { kind: "loading" } | { kind: "gone"; title: string; text: string } | { kind: "ready"; invite: InvitePreview };

export function Invite({ code }: { code: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  useEffect(() => {
    let live = true;
    api<InvitePreview>("GET", `/invites/${encodeURIComponent(code)}`).then(
      (invite) => live && setLoad({ kind: "ready", invite }),
      (err: unknown) => {
        if (!live) return;
        const status = err instanceof ApiError ? err.status : 0;
        setLoad(
          status === 410
            ? { kind: "gone", title: "This job already started.", text: "The crew is already inside. Ask the host to plan the next one." }
            : status === 404
              ? { kind: "gone", title: "That invite doesn't open anything.", text: "Check the link your host sent you; every letter counts." }
              : { kind: "gone", title: "We couldn't check that invite.", text: err instanceof Error ? err.message : "Try again in a moment." },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [code]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nickname = name.trim();
    if (!nickname) {
      setError("Pick a nickname your crew will see.");
      setShake((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      const game = await api<LobbyView>("POST", `/invites/${encodeURIComponent(code)}/join`, { nickname });
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
        <Button variant="back" seed="inv-back" icon={<ArrowBack />} onClick={() => navigate("/")}>
          Back <kbd>Esc</kbd>
        </Button>
      </TopBar>
      <main>
        <SketchFrame as="section" seed="invite-sheet" radius={22} tape holes className="sheet form-sheet enter-sheet" aria-labelledby="invite-title">
          {load.kind === "loading" && <p className="meta">Checking the invite…</p>}
          {load.kind === "gone" && (
            <>
              <h1 id="invite-title">{load.title}</h1>
              <p className="form-sheet__lede">{load.text}</p>
            </>
          )}
          {load.kind === "ready" && (
            <>
              <p className="kicker">You're invited</p>
              <div className="invite__head">
                {load.invite.host && <Avatar name={load.invite.host} size={46} />}
                <div className="invite__who">
                  <h1 id="invite-title">
                    Join <Underline seed="inv-crew">the crew</Underline>
                  </h1>
                  {load.invite.host && (
                    <p className="meta">
                      <b className="invite__host">{load.invite.host}</b> is hosting
                    </p>
                  )}
                </div>
              </div>
              <p className="form-sheet__lede">
                One bank, one crew, and everyone's skimming. <span className="num">{load.invite.seats}</span> of{" "}
                <span className="num">{load.invite.maxSeats}</span> seats taken.
              </p>
              <hr className="dashed" />
              <form className="form-sheet__form" onSubmit={submit} noValidate>
                <TextField
                  seed="nickname"
                  label="Your nickname"
                  placeholder="e.g. Lucky Lou"
                  autoComplete="nickname"
                  maxLength={24}
                  value={name}
                  shake={shake}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError(null);
                  }}
                  {...(error ? { error } : { hint: "Your crew sees this. No account needed." })}
                />
                <Button type="submit" variant="primary" seed="join-crew" icon={<Play />} block disabled={busy}>
                  Join the crew
                </Button>
              </form>
            </>
          )}
        </SketchFrame>
      </main>
    </div>
  );
}
