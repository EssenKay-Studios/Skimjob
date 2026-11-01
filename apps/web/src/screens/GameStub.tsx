// /game/:id: where a started game lands. The game screen itself is M2-6; until
// then this says who you play as and who's in the crew.
import { useEffect, useState } from "react";
import { api, ApiError, sentence, type LobbyView } from "../api";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { SketchFrame } from "../components/SketchFrame";
import { navigate } from "../router";
import { TopBar } from "./TopBar";

export function GameStub({ id }: { id: string }) {
  const [game, setGame] = useState<LobbyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<LobbyView>("GET", `/games/${id}`).then(setGame, (e: unknown) => setError(e instanceof ApiError ? sentence(e.message) : "Something went wrong."));
  }, [id]);
  const me = game?.seats.find((s) => s.you);
  return (
    <div className="page">
      <TopBar />
      <main>
        <SketchFrame as="section" seed="game-sheet" radius={22} tape holes className="sheet form-sheet enter-sheet" aria-labelledby="game-title">
          {error ? (
            <>
              <h1 id="game-title">No job here.</h1>
              <p className="form-sheet__lede">{error}</p>
              <Button variant="primary" seed="game-home" onClick={() => navigate("/")}>
                Back to the start
              </Button>
            </>
          ) : (
            <>
              <p className="kicker">Round 1 · First National</p>
              <h1 id="game-title">The job is on</h1>
              <p className="form-sheet__lede">
                {me ? (
                  <>
                    You're in as <b>{me.nickname}</b>. The game board opens in the next build.
                  </>
                ) : (
                  "Loading the crew…"
                )}
              </p>
              {game && (
                <ul className="game-crew" aria-label="The crew">
                  {game.seats.map((s) => (
                    <li key={s.seat}>
                      <Avatar name={s.bot ? s.nickname.replace(/^Bot · /, "") : s.nickname} size={40} bot={!!s.bot} title={s.nickname} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </SketchFrame>
      </main>
    </div>
  );
}
