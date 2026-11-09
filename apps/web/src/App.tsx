import { lazy, Suspense, useEffect } from "react";
import { SketchDefs } from "./components/SketchFrame";
import { ToastProvider } from "./components/Toast";
import { Button } from "./components/Button";
import { SketchFrame } from "./components/SketchFrame";
import { ArrowBack } from "./components/icons";
import { Game } from "./screens/Game";
import { Invite } from "./screens/Invite";
import { Landing } from "./screens/Landing";
import { Lobby } from "./screens/Lobby";
import { NewGame } from "./screens/NewGame";
import { navigate, usePath } from "./router";

// The gallery is a dev tool: only dev builds load it, so it stays out of the
// production bundle.
const Gallery = import.meta.env.DEV ? lazy(() => import("./screens/Gallery").then((m) => ({ default: m.Gallery }))) : null;
const ShellDemo = import.meta.env.DEV ? lazy(() => import("./screens/GalleryShell").then((m) => ({ default: m.ShellDemo }))) : null;

const RevealDemo = import.meta.env.DEV
  ? lazy(() =>
      import("./screens/GalleryReveal").then((m) => ({
        default: m.RevealDemo,
      })),
    )
  : null;

function NotFound() {
  return (
    <main className="notfound">
      <SketchFrame seed="404" radius={20} tape tilt={-0.6} className="sheet notfound__sheet enter-sheet">
        <h1>This door's locked.</h1>
        <p>There's nothing at this address. Maybe the job moved.</p>
        <Button variant="back" seed="404-back" icon={<ArrowBack />} onClick={() => navigate("/")}>
          Back to the start
        </Button>
      </SketchFrame>
    </main>
  );
}

export function App() {
  const path = usePath();
  useEffect(() => {
    // Esc goes back to the start from any sheet (ui-style §5 "Back [Esc]").
    const onKey = (e: KeyboardEvent) => {
      // Not from a lobby or a game: those are places, not sheets over the start.
      // An open dialog or sheet takes the Esc itself.
      if (e.key === "Escape" && location.pathname !== "/" && !/^\/(lobby|game)\//.test(location.pathname) && !document.querySelector("dialog[open]")) navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const route = path.replace(/\/+$/, "") || "/";
  const [, page, arg] = route.match(/^\/(join|lobby|game)\/([^/]+)$/) ?? [];
  const param = arg ? decodeURIComponent(arg) : "";
  return (
    <ToastProvider>
      <SketchDefs />
      {route === "/" ? (
        <Landing />
      ) : route === "/new" ? (
        <NewGame />
      ) : page === "join" ? (
        <Invite key={param} code={param} />
      ) : page === "lobby" ? (
        <Lobby key={param} id={param} />
      ) : page === "game" ? (
        <Game key={param} id={param} />
      ) : route === "/dev/gallery" && Gallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : route === "/dev/gallery/shell" && ShellDemo ? (
        <Suspense fallback={null}>
          <ShellDemo />
        </Suspense>
      ) : route === "/dev/gallery/reveal" && RevealDemo ? (
        <Suspense fallback={null}>
          <RevealDemo />
        </Suspense>
      ) : (
        <NotFound />
      )}
    </ToastProvider>
  );
}
