# Mockups for #294 (owner-approved, 13 Nov 2026)

Reference only. This branch is never merged.

- `*.png`: the five approved boards, rendered at 2x.
  1. Alibi pop-up.
  2. Snapshot card on a phone: the mark pop-over on an unmarked player, key closed.
  3. The card on a laptop: the pop-over on a Trusted player, key open.
  4. The case board: round picker, Leads, the pop-over on a Liar.
  5. The end-game reveal: TRUE/LIE.
- `source/mocks.tsx`: the code that drew them, using the real kit (`FrameArt`, `Avatar`, `RoomIcon`, `RoomInterior`, `AlarmBell`, `RaccoonNarrator`, `WantedStars`) with inline styles. Read it for exact sizes, gaps and colours, but build the real components with theme tokens and CSS classes, not inline styles.
  - To render it, copy it to `apps/web/mock/mocks.tsx`, bundle it with esbuild (`--platform=node --jsx=automatic --loader:.woff2=file`) and run it with an output folder.
  - It writes one static HTML fragment per board, plus the kit CSS.
