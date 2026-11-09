// The Tips setting (design §15.6): on the landing page and in the game menu.
import { Segmented } from "./Segmented";

export function TipsToggle({ tips, busy, onChange }: { tips: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <Segmented
      seed="tips"
      label="Tips"
      hint="Short how-to cards the first time something happens."
      options={[
        { value: true, label: "On" },
        { value: false, label: "Off" },
      ]}
      value={tips}
      busy={busy}
      onChange={onChange}
    />
  );
}
