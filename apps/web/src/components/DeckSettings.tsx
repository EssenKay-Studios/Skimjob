// Lobby: the deck, per-role toggles, deal style and role list (extension.md
// "Host settings", "Roles"). Quick games play the Starter deck with no events,
// shown read-only. Role names and tags come from content.
import { useId, useState } from "react";
import { DECKS, POOL_ROLES, ROLES, type RoleId } from "@skimjob/content";
import type { DeckId, LobbySettings } from "../api";
import { Button } from "./Button";
import { RoleTip } from "./Extension";
import { Segmented, type SegmentedOption } from "./Segmented";
import { TAG_LABEL, rolesByTag } from "../game/extension";

export const DECK_OPTIONS: readonly SegmentedOption<DeckId>[] = [
  { value: "starter", label: "Starter" },
  { value: "standard", label: "Standard" },
  { value: "everything", label: "Everything" },
];
const DEAL_OPTIONS: readonly SegmentedOption<LobbySettings["deal"]>[] = [
  { value: "balanced", label: "Balanced" },
  { value: "random", label: "Truly random" },
];
const LIST_OPTIONS: readonly SegmentedOption<LobbySettings["roleList"]>[] = [
  { value: "exact", label: "Exact" },
  { value: "possible", label: "Possible" },
  { value: "hidden", label: "Hidden" },
];
const DECK_HINT: Record<DeckId, string> = {
  starter: "First game: simple roles, no events, no shop",
  standard: "The default; Rookies fill spare seats",
  everything: "All the roles",
};
const DEAL_HINT: Record<LobbySettings["deal"], string> = { balanced: "A tested mix for the crew size", random: "Any roles from the deck" };
const LIST_HINT: Record<LobbySettings["roleList"], string> = {
  exact: "Everyone sees the roles dealt",
  possible: "Everyone sees the roles that could be in play",
  hidden: "Nobody is told which roles are in play",
};

export const QUICK_NOTE = "Quick games play the Starter deck with no event cards, tokens or shop.";

/** The deck players will get: Starter for Quick or starter mode, else the stored deck. */
export const effectiveDeck = (s: LobbySettings): DeckId => (s.sessionLength === "quick" || s.starterMode ? "starter" : s.deck);

/** The roles switched on: the toggles, or the deck's preset when there are none. */
export const deckRoles = (s: LobbySettings): readonly RoleId[] => (s.roles.length > 0 ? (s.roles as RoleId[]) : DECKS[effectiveDeck(s)]);

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** A deck choice as a settings patch: Starter is the starter mode (no events, no shop); the toggles reset. */
export function deckPatch(s: LobbySettings, deck: DeckId): Partial<LobbySettings> {
  if (deck === "starter") return { deck, roles: [], starterMode: true, eventsEnabled: false };
  return { deck, roles: [], ...(s.starterMode ? { starterMode: false } : {}) };
}

/** One role toggled, as a settings patch; back to [] when it matches the preset. Never empties the deck. */
export function rolePatch(s: LobbySettings, role: RoleId): Partial<LobbySettings> | null {
  const now = deckRoles(s);
  const next = now.includes(role) ? now.filter((r) => r !== role) : POOL_ROLES.filter((r) => r === role || now.includes(r));
  if (next.length === 0) return null;
  return { roles: sameSet(next, DECKS[s.deck]) ? [] : next };
}

export function DeckSettings({ settings, readOnly, disabled, onChange }: { settings: LobbySettings; readOnly: boolean; disabled: boolean; onChange: (patch: Partial<LobbySettings>) => void }) {
  const quick = settings.sessionLength === "quick";
  const deck = effectiveDeck(settings);
  const locked = quick || deck === "starter";
  const on = deckRoles(settings);
  const custom = settings.roles.length > 0;
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <>
      <Segmented<DeckId>
        seed="set-deck"
        label="Deck"
        hint={quick ? QUICK_NOTE : custom ? `${DECK_HINT[deck]} · your own pick of roles` : DECK_HINT[deck]}
        options={DECK_OPTIONS}
        value={deck}
        readOnly={readOnly || quick}
        disabled={disabled}
        onChange={(v) => onChange(deckPatch(settings, v))}
        wide
      />
      {!locked && (
        <div className="seg seg--wide deck-roles">
          <div className="seg__head">
            <span className="seg__label">Roles</span>
            <span className="meta">
              {on.length} of {POOL_ROLES.length} on{custom ? " (your pick)" : ""}
            </span>
          </div>
          {!readOnly && (
            <Button variant="small" seed="deck-roles" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)} className="deck-roles__toggle">
              {open ? "Done" : "Pick roles one by one"}
            </Button>
          )}
          {(open || readOnly) && (
            <div id={panel} className="deck-roles__groups">
              {rolesByTag(readOnly ? on : POOL_ROLES).map((g) => (
                <div key={g.tag} className="deck-roles__group" role="group" aria-label={TAG_LABEL[g.tag]}>
                  <p className="meta">{g.label}</p>
                  <div className="deck-roles__chips">
                    {g.roles.map((r) =>
                      readOnly ? (
                        <RoleTip key={r} id={r} />
                      ) : (
                        <Button
                          key={r}
                          variant="toggle"
                          seed={`role-${r}`}
                          pressed={on.includes(r)}
                          disabled={disabled}
                          onClick={() => {
                            const p = rolePatch(settings, r);
                            if (p) onChange(p);
                          }}
                        >
                          {ROLES[r]?.name ?? r}
                          {ROLES[r]?.winsOn.length ? " ★" : ""}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              ))}
              <p className="meta">★ can also win when the heist fails. Some roles need a bigger crew and sit out of small games.</p>
            </div>
          )}
        </div>
      )}
      <Segmented<LobbySettings["deal"]>
        seed="set-deal"
        label="Deal"
        hint={DEAL_HINT[settings.deal]}
        options={DEAL_OPTIONS}
        value={settings.deal}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(v) => onChange({ deal: v })}
      />
      <Segmented<LobbySettings["roleList"]>
        seed="set-roleList"
        label="Role list"
        hint={LIST_HINT[settings.roleList]}
        options={LIST_OPTIONS}
        value={settings.roleList}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(v) => onChange({ roleList: v })}
        wide
      />
    </>
  );
}
