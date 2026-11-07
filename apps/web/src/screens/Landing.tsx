// Landing (m2-plan M2-5): create a game (/new), join with an invite code
// (/join/:code), sign in with Google (M2-12; shown only when the server has a
// Google client id, else the top bar's "Sign in" just explains nicknames).
// Signed in with Google, the pass card's place shows "My games". Any signed-in
// user, guest or account, also gets the Tips setting (S3b.3), so /me is asked
// on every visit; signed out shows neither.
import { useEffect, useState, type FormEvent } from "react";
import { fetchMe, fetchMyGames, fetchProviders, googleSignInUrl, sentence, setTips, type Me, type MyGame } from "../api";
import { Avatar } from "../components/Avatar";
import { BankDoodle } from "../components/BankDoodle";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { MyGames } from "../components/MyGames";
import { Segmented } from "../components/Segmented";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { Wordmark } from "../components/Wordmark";
import { parseInviteCode } from "../inviteCode";
import { linkClick, navigate } from "../router";
import { Play, Star, Door } from "../components/icons";

const CREW = ["Mara Vox", "Dez", "Lucky Lou", "Priya K", "Otto"];

export function Landing() {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [google, setGoogle] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [games, setGames] = useState<MyGame[] | null>(null);
  const [savingTips, setSavingTips] = useState(false);

  useEffect(() => {
    let live = true;
    fetchProviders().then((p) => live && setGoogle(p.includes("google")));
    fetchMe().then(
      (u) => {
        if (!live) return;
        setMe(u);
        if (u && !u.guest) fetchMyGames().then((g) => live && setGames(g), () => {});
      },
      () => {}, // offline: the landing page works signed out
    );
    return () => {
      live = false;
    };
  }, []);

  const account = me && !me.guest ? me : null;
  const signIn = () => location.assign(googleSignInUrl("/"));

  // One save at a time, so replies can't arrive out of order.
  const changeTips = (on: boolean) => {
    setSavingTips(true);
    return setTips(on)
      .then(setMe, (e: unknown) => toast(sentence(e instanceof Error ? e.message : String(e))))
      .finally(() => setSavingTips(false));
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseInviteCode(code);
    if (!parsed) {
      setCodeError(code.trim() ? "That doesn't look like an invite code. Check the link your host sent." : "Paste the code or link your host sent you.");
      setShake((n) => n + 1);
      return;
    }
    setCodeError(null);
    navigate(`/join/${parsed}`);
  };

  return (
    <div className="landing">
      <header className="topbar">
        <a href="/" onClick={linkClick} className="topbar__home" aria-label="Skimjob home">
          <Wordmark size={30} />
        </a>
        <nav className="topbar__nav">
          {account ? (
            <span aria-label={`Signed in as ${account.name}`}>
              <Chip colour="var(--olive)">{account.name}</Chip>
            </span>
          ) : (
            <Button
              variant="secondary"
              seed="nav-signin"
              icon={<Door />}
              onClick={google ? signIn : () => toast("Sign-in is on its way. For now, you'll just pick a nickname.")}
            >
              Sign in
            </Button>
          )}
        </nav>
      </header>

      <main>
        <SketchFrame as="section" seed="landing-sheet" radius={24} tape holes className="sheet landing__sheet enter-sheet" aria-labelledby="pitch">
          <div className="landing__grid">
            <div className="landing__copy">
              <p className="kicker">A heist game for friends</p>
              <h1 id="pitch" className="landing__title">
                <span className="landing__line">Steal from your crew.</span>{" "}
                <Underline seed="pitch">Just don't sink the job.</Underline>
              </h1>
              <p className="landing__lede">
                Everyone picks a room, grabs the loot, then decides how much to hand in and how much to pocket. Biggest stash
                wins, but if the Heat hits 100 or you miss the target, nobody does.
              </p>

              <div className="landing__cta">
                <Button
                  variant="primary"
                  seed="create-game"
                  icon={<Play />}
                  className="landing__create"
                  onClick={() => navigate("/new")}
                >
                  Plan a heist
                </Button>
                <div className="landing__crew">
                  <span className="avatar-stack" aria-hidden="true">
                    {CREW.map((n, i) => (
                      <Avatar key={n} name={n} size={32} status={i === 1 ? "ready" : undefined} />
                    ))}
                  </span>
                  <span className="meta">2–12 players, bots welcome</span>
                </div>
              </div>

              <div className="landing__chips" aria-label="At a glance">
                <Chip colour="var(--sky)">1 hour to 7 days</Chip>
                <Chip colour="var(--olive)">9 rounds, 3 acts</Chip>
                <Chip colour="var(--gold)">Play in the browser</Chip>
              </div>

              <hr className="dashed" />

              <form className="join" onSubmit={join} noValidate>
                <h2 className="join__title">Got an invite?</h2>
                <div className="join__row">
                  <TextField
                    shake={shake}
                    seed="invite-code"
                    label="Invite code or link"
                    hideLabel
                    placeholder="Invite code or link"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      if (codeError) setCodeError(null);
                    }}
                    {...(codeError ? { error: codeError } : { hint: "Your host can find it in the lobby." })}
                    className="join__field"
                  />
                  <Button type="submit" variant="secondary" seed="join-btn" className="join__btn">
                    Join crew
                  </Button>
                </div>
              </form>

              {me && (
                <>
                  <hr className="dashed" />
                  <Segmented
                    seed="tips"
                    label="Tips"
                    hint="Short how-to cards the first time something happens."
                    options={[
                      { value: true, label: "On" },
                      { value: false, label: "Off" },
                    ]}
                    value={me.tips}
                    disabled={savingTips}
                    onChange={changeTips}
                  />
                </>
              )}
            </div>

            <div className="landing__art">
              <SketchFrame seed="hero-art" radius={18} fill="var(--card-sand)" shadow={0.5} className="hero-card">
                <BankDoodle className="hero-card__img" />
                <p className="hero-card__caption">
                  <span className="hand">First National</span>
                  <span className="meta">the only job in town, for now</span>
                </p>
              </SketchFrame>
            </div>

            {google && !account && (
              <div className="landing__pass">
                <SketchFrame seed="pass-card" radius={16} fill="url(#sk-pass)" ink="var(--pass-line)" shadow={0.55} grain={false} tilt={0.6} className="pass-card">
                  <div className="pass-card__text">
                    <h2 className="pass-card__title">Keep your rap sheet</h2>
                    <p>Sign in to keep your name and record between jobs. To play, a nickname is enough.</p>
                  </div>
                  <Button variant="premium" seed="pass-btn" icon={<Star />} onClick={signIn}>
                    Sign in with Google
                  </Button>
                </SketchFrame>
              </div>
            )}
            {account && games && (
              <div className="landing__pass">
                <MyGames games={games} />
              </div>
            )}
          </div>
        </SketchFrame>
      </main>

      {import.meta.env.DEV && (
        <footer className="landing__foot meta">
          <a href="/dev/gallery" onClick={linkClick}>
            Component gallery
          </a>
        </footer>
      )}
    </div>
  );
}
