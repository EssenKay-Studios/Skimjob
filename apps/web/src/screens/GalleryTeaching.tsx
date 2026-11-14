// /dev/gallery: the teaching pop-up for each lesson, each ruleset guide step
// (design §14), and the game menu with the Tips setting (design §15.6, §20.6).
// No server: the toggle just flips here.
import { useState } from "react";
import { LESSONS, RULESETS, type GuideStep, type LessonId } from "@skimjob/content";
import { Button } from "../components/Button";
import { GameMenu } from "../components/GameMenu";
import { SketchFrame } from "../components/SketchFrame";
import { GuidePopup, TeachingPopup } from "../components/TeachingPopup";
import { Underline } from "../components/Underline";

/** Every guide step of every ruleset that has one. */
const GUIDE: readonly GuideStep[] = Object.values(RULESETS).flatMap((r) => r.guide);

export function TeachingSection() {
  const [lesson, setLesson] = useState<LessonId | null>(null);
  const [step, setStep] = useState<GuideStep | null>(null);
  const [tips, setTips] = useState(true);
  return (
    <SketchFrame as="section" seed="g-teaching" radius={16} shadow={0.5} className="g-section" aria-labelledby="g-teaching">
      <header className="g-section__head">
        <h3 id="g-teaching">
          <Underline seed="teaching">Teaching pop-ups</Underline>
        </h3>
        <p className="meta">S4.6 · design §15.6, §20.6 · what happened, what it means, what you can do</p>
      </header>
      <div className="g-row">
        {(Object.keys(LESSONS) as LessonId[]).map((id) => (
          <Button key={id} variant="secondary" seed={`g-lesson-${id}`} aria-haspopup="dialog" onClick={() => setLesson(id)}>
            {LESSONS[id].title}
          </Button>
        ))}
        <GameMenu tips={tips} busy={false} onChange={setTips} />
      </div>
      <p className="meta">S4.10 · design §14 · Learn the game: one guide pop-up per step</p>
      <div className="g-row">
        {GUIDE.map((g) => (
          <Button key={g.id} variant="secondary" seed={`g-guide-${g.id}`} aria-haspopup="dialog" onClick={() => setStep(g)}>
            {g.title}
          </Button>
        ))}
      </div>
      <TeachingPopup lesson={lesson} busy={false} onGotIt={() => setLesson(null)} onTipsOff={() => setLesson(null)} />
      <GuidePopup step={step} place={step ? `${GUIDE.indexOf(step) + 1} of ${GUIDE.length}` : ""} onGotIt={() => setStep(null)} />
    </SketchFrame>
  );
}
