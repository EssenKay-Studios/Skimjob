// Saves the case board's pin list (design §15.4) one write at a time, so the
// last choice always wins and the screen can't end up showing a pin the server
// refused: writes go out in order, only the newest list is sent, and a failed
// write puts the screen back to what the server really holds.
import { togglePin } from "./caseBoard";

export interface PinIo {
  /** Replaces the saved list. */
  readonly put: (list: readonly string[]) => Promise<void>;
  /** The saved list, as the server has it. */
  readonly load: () => Promise<readonly string[]>;
}

export interface PinSync {
  readonly toggle: (id: string) => void;
}

/** `onList` gets every list to show (at once on a tap, and after a failed write); `onError` the failure. */
export function pinSync(io: PinIo, saved: readonly string[], onList: (list: readonly string[]) => void, onError: (e: unknown) => void): PinSync {
  let shown = saved;
  let acknowledged = saved;
  let busy = false;
  const flush = async () => {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        const sent = shown;
        try {
          await io.put(sent);
        } catch (e) {
          shown = await io.load().catch(() => acknowledged);
          acknowledged = shown;
          onList(shown);
          onError(e);
          return;
        }
        acknowledged = sent;
        if (shown === sent) return;
      }
    } finally {
      busy = false;
    }
  };
  return {
    toggle(id) {
      shown = togglePin(shown, id);
      onList(shown);
      void flush();
    },
  };
}
