// The signed-in user and their Tips setting, for the game screen (design §15.6).
import { useCallback, useEffect, useState } from "react";
import { fetchMe, sentence, setTips, type Me } from "../api";
import { useToast } from "../components/Toast";

export interface TipsState {
  /** Null until /me answers, and when it can't (offline, signed out): no pop-ups then. */
  readonly me: Me | null;
  readonly saving: boolean;
  readonly change: (on: boolean) => void;
}

export function useTips(): TipsState {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    fetchMe().then(
      (u) => live && setMe(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  // One save at a time, so replies can't arrive out of order.
  const change = useCallback(
    (on: boolean) => {
      setSaving(true);
      setTips(on)
        .then(setMe, (e: unknown) => toast(sentence(e instanceof Error ? e.message : String(e))))
        .finally(() => setSaving(false));
    },
    [toast],
  );
  return { me, saving, change };
}
