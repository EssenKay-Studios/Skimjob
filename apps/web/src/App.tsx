import { lazy, Suspense, useEffect } from "react";
import { SketchDefs } from "./components/SketchFrame";
import { ToastProvider } from "./components/Toast";
import { Button } from "./components/Button";
import { SketchFrame } from "./components/SketchFrame";
import { ArrowBack } from "./components/icons";
import { Landing } from "./screens/Landing";
import { navigate, usePath } from "./router";

// The gallery is a dev tool: only dev builds load it, so it stays out of the
// production bundle.
const Gallery = import.meta.env.DEV ? lazy(() => import("./screens/Gallery").then((m) => ({ default: m.Gallery }))) : null;

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
      if (e.key === "Escape" && location.pathname !== "/") navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const route = path.replace(/\/+$/, "") || "/";
  return (
    <ToastProvider>
      <SketchDefs />
      {route === "/" ? (
        <Landing />
      ) : route === "/dev/gallery" && Gallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : (
        <NotFound />
      )}
    </ToastProvider>
  );
}
