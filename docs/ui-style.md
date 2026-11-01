# Skimjob UI Style Guide: "sketchbook city" (style reference: CityRT)

Reference captured 2026-11-01 from cityrt.com (home, /styles, /catalog, /how, /login, /changes) at
1280x800 and 390x844. Screenshots are in `/home/claude/ui-ref/shots/`. Close-ups are in `shots/zoom/`.

**Evidence and limits.** The game itself sits behind a sign-in wall. Both "Play for Free" and
"Or play in the browser" go to `/en/login?next=play`, and there is no guest or demo mode. In-game
**3D renders** came from the marketing imagery (`shots/zoom/ingame-render-*.png`,
`catalog-building-*.png`). The in-game **HUD** values (toolbar, stats, toasts, feed, inspector)
come from the site's public stylesheets (`dl/css/shell-*.css`, `play-*.css`), which define the
`sk-*` HUD classes. All hex values and sizes below come from those stylesheets, checked against
pixel samples (`sample_colors.py`).

We copy the **style** only. See "Do not copy" at the end.

---

## 1. Overall aesthetic

The look is **a stylised 3D toy world, with UI drawn as a hand-made sketchbook on top**.

- **World layer:** low-poly 3D buildings with ink outlines (cel/toon shading). Colours are warm
  and slightly desaturated, and every building is shown in 3/4 view (isometric-ish). Read it as
  "architectural model meets comic book".
- **UI layer:** cream paper sheets with wobbly black ink borders. The shadows are **pencil
  hatching**, not blur. Panels have masking-tape strips, a column of spiral-binding holes and
  faint paper grain. Headings are hand-lettered and body text is a clean sans.
- **Feel:** cosy, tactile and a bit playful. Nothing is perfectly straight. Panels sit at small
  rotations (±0.5–2.5°), hover lifts and tilts by -1°, and panels arrive with a springy
  overshoot.
- **Restraint:** one warm accent colour (clay orange) on neutral paper. A dark-purple "premium"
  card with gold is the only strong contrast. There are no gradients on regular UI, no glassmorphism
  and no neon.

## 2. Colour palette

### Core tokens (exact values from their `:root`; use these as Skimjob CSS variables)

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#faf9f5` | main sheet / panel fill |
| `--paper-hi` | `#fffdf8` | raised card / hover fill |
| `--paper2` | `#f3ede0` | secondary fill, meter tracks, page backdrop tint |
| `--oat` | `#e3dacc` | dividers, disabled fills |
| `--manilla` | `#ebdbbc` | folder / case-file fills |
| `--card-sand` | `#f1dec4` | item thumbnail backdrop (sampled from catalog cards) |
| `--plinth` | `#e8d4b6` | the oval "display plinth" under a building (sampled) |
| `--ink` | `#2a2320` | outlines, headings, primary text (warm near-black, never #000) |
| `--ink2` | `#4a403a` | body text |
| `--mute` | `#85796d` | captions, subtitles, meta |
| `--clay` | `#d97757` | **primary accent**: primary buttons, active chip/tab, underlines |
| `--clay-hover` | `#e08565` | primary hover |
| `--clay-d` | `#b35a3c` | accent text, pressed, links |
| `--clay-l` | `#f4d6c8` | selected item tint, active nav pill (`#f4ece8` sampled) |
| `--kraft` | `#d4a27f` | masking tape (at 60% alpha) |
| `--olive` | `#788c5d` | "free" badge, nature |
| `--good` | `#4f7f34` | positive numbers, +money floats |
| `--bad` | `#b5443a` | negative, danger, armed/destructive |
| `--sky` | `#6a9bcc` | info, water |
| `--gold` | `#e2b858` | coins, stars |

### Premium ("Pass") palette, a dark exception card

| Token | Hex |
|---|---|
| bg gradient | `#3b2c62` → `#2b2449` (160°) |
| outline | `#171230` |
| gold | `#f6bc45`; gold-dark `#d99a1e` |
| cream text | `#fff4de`; muted `#c8bedf` |

### World / building palette (quantised from renders)

- Brick: `#a56347`, `#97664f`. Terracotta roof: `#d0623f`–`#e07a52`. Slate roof: `#5c6064`, `#615b55`.
- Ochre/yellow stucco: `#e0bc84`, `#d7bc8f`, `#e5c697`. Cream stucco: `#efe6d6`.
- Grass (map): `#9ba17a`–`#a2b372`. Trees: `#5d7a45` with darker `#3f5a33` shading. Asphalt: `#3a3633`. Sidewalk: `#b4a590`.
- Night: sky `#545888`→`#272b3c`, lit window `#f4c76a`/`#ffd98a`, street-lamp glow `#f2a65a`.
- Style-category dots (each used as a small swatch or underline under a card title): `#9a5541`
  (brick), `#c46686` (rose), `#b7684f` (rust), `#6a9bcc` (sky), `#788c5d` (olive), `#6b5aa6`
  (violet), `#3d5a80` (navy).

**Rules.** Text is always `--ink`/`--ink2` on paper. Large fills (clay, bad, good) use cream text
`#fff7ee`. Coloured fills inside meters and swatches get a **diagonal hatch overlay**:
`repeating-linear-gradient(-55deg, #2a23204d 0 1px, transparent 1px 3px), var(--c)`.

## 3. Typography

| Role | Font | Free equivalent | Spec |
|---|---|---|---|
| Hand-lettered headings, button labels, tabs, tool labels, numbers in badges | **Pangolin** (Google Font, 400 only, synthetic bold via `font-weight:700`) | Pangolin itself is free (OFL). Alternatives: *Patrick Hand*, *Gochi Hand*, *Itim*, *Mali* | fallbacks: `"Segoe Print","Bradley Hand","Comic Sans MS",cursive`; `size-adjust:96%` |
| UI / body | **Inter** 400–700 (variable) | Inter (Google Font) | fallbacks: `"Segoe UI",system-ui,-apple-system,sans-serif` |
| Numbers (money, counters) | Inter, `font-weight:650`, `font-variant-numeric:tabular-nums`, `letter-spacing:-.01em` | | |

Scale (desktop):

- Page title `h1`: Pangolin 700 **32px**/1.7 (27px when height ≤ 800). Subtitle: Inter 500 13.5px `--mute`, sitting directly under the title.
- Section `h2`: Pangolin 700 21px/1.2. Dialog `h3`: Pangolin 700 24px/1.15. Panel `h3`: Pangolin 700 17px with a **clay pencil underline** (an SVG path, 2px stroke, round caps, slightly crooked, 7px tall, extending 3px past the text).
- Card title: Pangolin ~19px, with a 2.5–3px coloured underline bar about 60% of the title width, slightly rotated.
- Body: Inter 13–14.5px/1.4–1.45 `--ink2`. Captions and meta: Inter 600 11–12px `--mute`.
- Primary button label: Pangolin 700 **17–18px**. Secondary button: Inter 600 13–14.5px.
- Keyboard hints: `<kbd>` boxes in Inter 700 ~11px, 1.2px `--ink2` border, radius 5px, paper2 fill (e.g. "Esc", "T", "Ctrl").

## 4. Cards and panels: the "sketch frame"

Each panel is an SVG frame drawn behind the content (do not use CSS `border`). Write our own
generator (`packages/ui/sketchFrame.ts`) with these layers, bottom to top:

1. **Hatched shadow.** The same outline offset by **(+3.5px, +4.5px)** and filled with a hatch
   pattern: 4.2px tile, rotated 38°, line `#2A2320` 1.15px at 62% opacity. Overall opacity is 0.62
   for big sheets and 0.35–0.4 for buttons. Use this instead of a blurred `box-shadow`.
2. **Body.** Filled with `--fr-fill` (default `--paper`), transitioning fill over .18s.
3. **Paper grain.** A 220×220 tiling noise or fibre texture over the body (subtle curly fibres,
   about 3–6% contrast). Make ours with SVG `feTurbulence` or a generated PNG.
4. **Edge burn.** An inner 10px stroke of `#c9a383` at 20% opacity, clipped to the shape, so the
   edges look slightly aged.
5. **Ink outline.** A variable-width filled path, about **1.8px** average and thicker at corners,
   with wobble amplitude around 1.1px. Corner radius is 12px (18–26px on big sheets), applied
   slightly differently on each corner. Width and height get a small skew of
   `min(2.2, 0.01*(w+h))`px.
6. **Pencil ghost line.** A second, thinner path (0.8px at 26% opacity) slightly offset from the
   ink line, like a construction line.

**Seeded wobble.** Every frame uses a deterministic seed, so it looks the same on every render.

**Line boil (optional, for "alive" elements).** Generate 3 variants of the outline and cycle
through them every 0.18s (`animation: .54s step-end infinite`, with the variants offset by -0.18s
and -0.36s). Apply it only to focused, hot or alert elements.

If CSS is enough (simple cards), approximate with
`border:2.2px solid #2a2320; border-radius:18px 24px 16px 26px/22px 16px 26px 18px;`. Their own
modal uses exactly that.

**Sheet furniture (big panels and full pages):**

- **Masking tape:** two strips, 92×24px, at `top:-12px`, about 6% in from the left and right.
  Left: `repeating-linear-gradient(90deg,#ffffff2e 0 6px,transparent 6px 13px), #d4a27f99`,
  rotated -4°. Right: the same with `#d9775773`, rotated +5°. Shadow `0 1px 2px #2a23201f`.
- **Spiral/punch holes:** a 10px-wide column 10px from the left edge, starting 46px from the top
  and ending 46px from the bottom. Use `radial-gradient(circle at 5px 5px,#2a232061 0 3.2px,#2a232014 3.4px 4.6px,transparent 4.8px) 0 0/10px 34px repeat-y`
  at 75% opacity.
- **Header divider:** `1.3px dashed #2a232040` under the page title.
- **Rotation:** dialogs and promos at -0.5° to +0.8°. Item thumbnails stay straight.
- **Backdrop shade** behind full-screen sheets: `radial-gradient(#f3ede06b 0%,#f3ede09e 70%,#d6c4aabf 100%)`
  over the 3D world (the world stays visible and washed out), sometimes with a 1.5px backdrop blur.

**Item cards (catalog style).** A sand thumbnail (`--card-sand`) with a 1px ink border and 12px
radius. The object sits on a soft lighter oval "plinth" (`--plinth`). The title (Pangolin) and
category (Inter 600 `--mute`) go **below** the thumbnail, outside the frame.

**Chips/filters.** Height about 30px, radius about 10px, 1.3px ink border, paper fill. A 12px
colour dot sits before the label. The active chip is filled clay with cream text and no dot.

## 5. Buttons

| Variant | Fill | Text | Size | Notes |
|---|---|---|---|---|
| **Primary** | `--clay` `#d97757` | `#fff7ee`, Pangolin 700 17–18px | h 46–48px, pad `0 26px 3px` | sketch frame + hatched shadow; leading ▶ or icon; full-width on mobile |
| **Secondary** | `--paper` | `--ink`, Inter 600 14.5px | h 40px, pad `0 16px` | sketch frame, shadow .4 |
| **Small / icon** | `--paper` | Inter 600 13px | 32×32 min | shadow .35 |
| **Toggle on** | `--clay` | `#fff7ee` | — | used for speed / active tool |
| **Ghost** | transparent | ink | — | no shadow |
| **Danger** | paper, red text → **armed** = `--bad` fill, `#fff4ec` text + shake (.35s) | | | arm on first click, confirm on second |
| **Premium** | gold gradient `#f6bc45`→`#e9a92c`, 2px `#171230` border | `#2a2320` Inter 700 | h 46px | only on dark premium card; star icon; periodic "bang" wiggle |
| **Back** | paper with **clay outline** | "‹ Back [Esc]" | h 38px | top-left of every sheet |

States (all buttons):

- hover: `translateY(-1.5px) rotate(-1deg)` and the fill lightens (`#fffdf8`, or `#e08565` for
  primary).
- active: `translateY(1px) scale(.97)`.
- focus-visible: `2.5px solid --clay` outline, offset 3px, radius 8px.
- disabled: opacity .45 plus `grayscale(.6)`.
- Transitions: `transform .16s var(--spring)` with `--spring: cubic-bezier(.3,1.55,.5,1)`.

## 6. Iconography

- Line icons in a hand-inked look: 24px box, ~1.8px ink stroke with round caps, slightly
  imperfect. Some include **small flat colour fills** (e.g. the overlapping red, yellow and blue
  circles for "Styles", the pink heart for "Sign in", the gold star for "Pass"). The colour fills
  sit slightly off the outline, like misregistered print.
- Sizes: 20–21px in buttons, 38px in toolbar tools, 34px in item tiles, 44px in inspector headers.
- Tool icons sit on a soft irregular **colour blob** behind them (42×38px,
  `border-radius:52% 48% 55% 45%/50% 58% 42% 50%`, 75% opacity). On hover the blob scales to 1.12
  and rotates -8°.
- Icon wiggle on hover: swap between 2 drawn variants (the line-boil idea at a smaller scale).
- Round avatars and badges use a *slightly* non-circular radius: `50% 46% 52% 48%`.
- Badges: "free" is an olive pill with cream text. "★ Pass" is a navy `#2b2449` pill with gold text
  and a 1.2px dark border. Both use a 6–8px radius and sit at the top-right of image cards.

## 7. Buildings, characters and world rendering

- **Projection:** real 3D (WebGL), viewed from a **3/4 elevated angle** (around 30–35° pitch,
  45° yaw), so it reads as isometric. Catalog shots use an orthographic-looking 3/4 view, while
  street renders use perspective.
- **Shading:** toon/cel shading with **2–3 flat tones per material** (lit, shade, deep shade).
  Lighting is soft and directional from the upper left. There are no specular highlights or
  textures beyond simple brick and tile lines.
- **Outlines:** dark warm-brown ink (`~#3a2a22`, not black) on silhouettes and major creases. The
  weight is about **1–1.5px at catalog scale** and stays roughly constant on screen.
- **Detail level:** "architectural model". Window frames, balconies, fire escapes, water towers,
  chimneys, awnings and little potted trees are present, but simplified into chunky primitives.
  Trees are low-poly blobs (faceted spheres or cones) on thin trunks.
- **Colour:** warm, earthy and slightly desaturated (brick, terracotta, ochre, slate, sage). The
  accent colours come from roofs. Grass is dusty sage, not saturated green.
- **Presentation:** single objects stand on a pale oval plinth with a soft contact shadow, on a
  sand background.
- **Time of day:** dusk and night are a signature. Windows light up one by one in warm yellow
  against a blue-violet sky.
- **Characters:** the in-world people are tiny and simple. The UI uses a **mascot-style ink
  doodle** (a blinking, bobbing little creature) for advisors and notifications. Mascots blink
  (`scaleY` to .12 at 95% of a ~4s cycle) and bob ±4–8px.
- **For a 2D browser game:** if we don't use WebGL, the look can be reproduced with **2D
  isometric illustrations in a flat cel style**: 3 tones per face, a 1.5px warm-ink outline and
  hatched shadows.

## 8. In-game HUD layout (from their in-game CSS)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [stats card: money · population · clock+date · speed ▶▶▶] [sys/menu]│  top bar: grid 1fr auto 1fr,
│                                                                      │  inset 12px top / 14px sides
│ [feed head ⓜ 3]                                    ┌ inspector ───┐  │
│  ┌chirp┐  ← news/advisor feed, 318px wide,          │ icon  Title  │  │  inspector: 322px wide,
│  ┌chirp┐    left 14px, top ~136px, stacks           │ sub-meta     │  │  top 84px, right 14px,
│                                                     │ meters/bars  │  │  slides in from right 18px
│                                                     └──────────────┘  │
│                          ( 3D world )                                │
│                 [ toast ]  [ toast ]   ← centred above toolbar       │
│           ┌ sub-panel: tabs ▔▔ · items grid (92×88 tiles) ┐          │  sub-panel unfolds upward
│           └───────────────────────────────────────────────┘          │
│        [ tool ][ tool ][ tool ][ tool ][ tool ][ tool ]               │  toolbar: bottom 14px, centred
└──────────────────────────────────────────────────────────────────────┘
```

- **Stats card:** a sketch frame, min-height 60px, padding `7px 13px 7px 16px`, gap 14px. Numbers
  use Inter 650 at about 16.5–18px, tabular, with a small caption underneath. A "+" top-up button
  is a 24px wobbly circle in green. The clock is a drawn 36px clock face.
- **Vertical mini-bars** (demand / need meters): 13×33px tracks with a 1.4px ink border and radius
  `3px 4px 2px 5px`. The fill rises with a spring over .8s and has the hatch overlay. Labels are
  Pangolin 12px. A "hot" bar bobs up and down 2px.
- **Horizontal meter:** 9px tall with a 1.3px ink border on a paper2 track. The fill is hatched in
  `--c` and animates its width over .6s with the spring easing.
- **Toolbar:** a sketch-framed strip holding 80×72px tools: a 38px icon with a Pangolin 13.5px label
  under it and the hotkey `<kbd>` revealed at the top-right on hover. Hover:
  `translateY(-3px) rotate(-2deg)`. The active tool's icon is scaled 1.08 and rotated -3°. Tools
  shrink to 70×64 below 1400px wide.
- **Sub-panel (drawer):** min 300px, max 900px. It unfolds from the bottom (`scaleY .86→1`,
  rotate -0.6°, .28s spring). The header is a Pangolin 17px title with a clay squiggle underline
  and a right-aligned hint in Inter 12px `--mute`. Tabs are Pangolin 12.5px with a clay 2.5px
  underline that scales in at a -1.5° tilt.
- **Toasts:** small sketch-framed pills (Inter 600 13.5px, a 20px icon, padding `6px 15px 7px 10px`)
  stacked with a 7px gap. They pop in from 8px below at scale .9 and leave upward with a fade.
- **Feed "chirps"** (social-style notifications): a 36px blob avatar, then a Pangolin 13px name
  with an Inter 11px handle and time, Inter 12.8px text and a meta row of small icons. They slide
  in from 14px below with a -1.5° tilt.
- **Floating numbers** over the world (e.g. "+$120"): Inter 750 14px with a paper-coloured halo
  (`text-shadow: 0 0 3px paper, 0 0 6px paper`). They pop to 1.05 scale and drift 16–26px over
  1.4s.
- **Pause:** a clay-coloured sketch frame inset 5px around the whole viewport, plus a rubber-stamp
  "PAUSED" label that slams in (from scale 1.5 and -9° rotation).
- **Banners:** a centred top banner with the mascot and a Pangolin 22px `--clay-d` title. It drops
  in from -18px at scale .8 and -3° rotation.

## 9. Motion

- Easing: `--spring: cubic-bezier(.3,1.55,.5,1)` everywhere (overshoot). Use
  `cubic-bezier(.2,.85,.3,1)` for sliding panels.
- Durations: hover .16s, popovers and toasts .28–.32s, dialogs .3–.5s, page sheets .55s.
- Entrances combine translate, a small rotation (±1–3°) and a scale of .95–.97. Nothing fades
  straight in.
- Hover always means a lift plus a tilt. Press means a scale down to .95–.97.
- Ambient effects: line boil on hot elements, mascot blink and bob, a "?" or star badge that
  wiggles every few seconds (`0–82%` idle, then a fast ±8–12° shake), and an arrow that nudges
  ±5px to point at a required action.
- Error: horizontal shake (-4 / +3 / -2px).
- Respect `prefers-reduced-motion`: drop every entrance animation and the boil.

## 10. Mobile behaviour (390×844)

- Sheets go nearly full-bleed with 12px page padding. Tape and spiral holes stay; the rounded ink
  frame still wraps the whole screen.
- The home page becomes a single column: logo row (with a language pill and a "☰ Menu" button in a
  clay outline) → a hero render in a rounded ink frame → a Pangolin ~24px headline → a
  full-width primary button → the premium card.
- Filter chips become a **horizontal scroll row** with no wrapping.
- Grids drop to **2 columns** (catalog) or 1 column (styles, how-to steps).
- The Back button shrinks to an icon-only 48×48 clay-outlined square.
- *Their weakness to avoid:* long page titles wrap awkwardly beside the subtitle ("How to / Play").
  On mobile, Skimjob should put the subtitle **below** the title and let the title use the full
  width.
- In game, plan for a **bottom-sheet** toolbar (thumb reach), a collapsible top stats strip, and an
  inspector that becomes a bottom sheet instead of a right-hand panel.

---

## Applying this to Skimjob

The bank becomes the "city": a 3/4-view cutaway building that the UI sits on top of as
sketchbook paper. Below, `[frame]` means the sketch frame from §4.

### Bank cutaway (main board)
- Draw a **3/4 isometric cutaway** of one bank, like a doll's house with the front wall removed.
  Floors stack vertically: Rooftop (top), Security + Office (upper floor), Lobby (ground), Vault
  (basement). Extra rooms (Server Room, Teller Cage, Manager's Suite, Loading Dock, Archive,
  Air Ducts) attach as side wings or mezzanines.
- Render it in the CityRT building style: cel-shaded 2–3 tones, a warm-ink outline (~1.5px),
  brick, stone and terracotta materials, chunky simplified props (a vault door wheel, desks, a
  camera bank, an HVAC unit and a helipad-style hatch on the roof).
- Each room is a hit area. On hover the room lifts (`translateY(-3px)`) and gets a clay pencil
  outline. A selected room gets a line-boiling clay outline plus a pin (like their scenario pins:
  a bobbing marker with a ring pulse).
- **Time-of-day lighting tracks session progress.** Early rounds are daylight. The final round is
  night, with windows lit room by room (their signature cue). The Heat level tints the sky: calm
  sage/blue at low Heat, sirens with a red-blue rim glow near 100.
- Show the sky and street around the bank as a washed-out backdrop. Full-screen sheets get the
  radial cream shade over the scene.

### Player avatars
- 36–46px **blob-circles** (`border-radius:50% 46% 52% 48%`) with a 1.4–1.8px ink border, filled
  with a crew colour taken from the style-dot palette (§2), showing a hand-drawn mask or
  balaclava doodle or the player's initial in Pangolin 700 on cream.
- On the board, show tiny cel-shaded crew figures (simple capsule bodies with masks) standing in
  rooms, with the same ink outline as the building. Keep them toy-like; avoid detailed faces.
- Status marks: a clay dot for "move submitted", line boil when it's that player's turn to vote,
  and a grey wash when the player is away.

### Round-move panel (pick room + split loot)
- A **bottom drawer sub-panel** (§8). Header: "Round 3 · Pick your room" in Pangolin 17px with a
  clay squiggle. The hint on the right reads "locks in 4h 12m".
- Room picker: a row of **item tiles** (92×88) with a room icon on a colour blob, the room name in
  Inter 600 12px, and a risk/loot hint as a mini `sw` swatch bar. Number keys 1–9 are shown as
  `<kbd>` on hover.
- After looting, the **split slider** sits on a paper track, 9px tall with an ink border. Left of
  the handle is "To Haul" (olive hatched fill) and right of it is "Pocket → Stash" (clay hatched
  fill). The handle is a 24px wobbly circle with a hatched shadow. The live numbers above it use
  tabular Inter 650, and the Pocket side flashes `sk-pulse-b` (scale 1.08, red) as greed grows.
  End with a **Primary** "Lock it in ▶" button.

### Heat meter
- A vertical **thermometer bar** in the top HUD (a scaled-up `sk-bar`: 16×80px, ink border, radius
  `3px 4px 2px 5px`). The fill is hatched and moves from `--olive` through `--gold` and `--clay`
  to `--bad` as Heat rises, with spring easing over .8s.
- Above 70 the bar gets `.hot` (a 2px bob) and its frame starts to boil. At 90+ a red pause-style
  frame pulses around the viewport edge. The label "Heat 64/100" is set in Pangolin 12px.

### Haul counter
- A **stats card** at the top centre: a drawn duffel-bag or vault icon, then "$ 48,200" in Inter
  650 18px tabular, with "target $60,000" captioned underneath. A thin horizontal hatched meter
  shows progress to the target, with a gold notch at the target.
- When money is added, show a floating "+$4,000" in `--good` drifting up from the room. If the
  final target is missed, the counter shakes and turns `--bad`.

### Ledger / case file
- A full-page **sheet** (tape, spiral holes, dashed header) styled as a **manila case file**: body
  fill `--manilla` with a folder tab on top, paper-clipped polaroid-style round cards (rotated
  ±1.5°), and typewriter-ish rows in Inter.
- Public ledger entries are rows separated by dashed rules. Private notes ("only you") get a
  `--clay-l` highlighter band and a small lock icon. Redacted lines are ink bars with a pencil
  hatch.
- A "While you were away" recap uses the **feed chirp** pattern, stacked, with a mascot-style
  narrator (our own creature, for example a raccoon in a mask).

### Chat
- The left-side **feed** column (§8), 300–318px wide and collapsible to a "💬 3" head button with
  a clay count badge.
- Messages are chirps: blob avatar, Pangolin name, Inter text and a muted time. System and game
  events appear as compact toasts inline in the feed with an icon.
- The composer is a paper input with a 1.3px ink border, a 10px radius and a small primary
  send button. On mobile the feed becomes a bottom sheet tab.

### Vote window
- A centred **dialog sheet**, `width:min(520px,100%)`, rotated -0.5°. It enters from -30px with a
  -3° rotation (like their `st-vote`).
- Title in Pangolin 24px: "Abort the job?" or "Who's skimming?". Show options as tiles or avatar
  chips. The tally bars fill with hatched gold (`#f2b640`) for the leading option and green
  (`#2f6b2a`) for passed. Yes/No buttons use the **danger → armed** confirm pattern for
  irreversible votes.
- The countdown is a drawn clock face (36px) with hands.

### End-of-game reveal
- **Phase 1:** the bank goes to night and windows light one by one. Each player's stash is
  revealed as a manila envelope that flips open (rotate plus spring) to show a stamped amount.
- **Phase 2:** a "JOB DONE" / "BUSTED" **rubber stamp** slams onto the screen (scale 1.5 → 1,
  -9° rotation, clay or red ink, slightly transparent and grainy).
- **Phase 3:** a podium **sheet** ranks stashes as catalog-style cards (avatar on a plinth oval,
  Pangolin name, tabular amount) and replays notable ledger events as chirps. If the heist failed,
  every card gets a grey wash and a red "VOID" stamp.

### Implementation notes
- Put tokens in `apps/web/src/theme.css` as CSS variables named as in §2.
- Make one `<SketchFrame seed w h fill shadow boil>` component that renders the SVG layers from §4
  behind content with `isolation:isolate`, and cache the generated paths by (w, h, seed).
- Fonts: self-host Pangolin + Inter (both OFL) as woff2.
- The same frame and tokens map to Flutter via `CustomPainter` (wobbly border, hatched shadow) and a shared token file exported from `theme.css`.

---

## Do not copy

- The **CityRT name, wordmark** (the black "City" plus clay "RT" lettering with a skyline sketch
  and underline) or any lettering based on it.
- The **Rubik's-cube-style logo** and the **mascot creature** design. Draw our own mascot.
- Any of their **renders and artwork**: the title backgrounds (Eiffel evening, lighthouse dusk,
  night street, etc.), the style-preview images, the building-catalog models and the icons. Do not
  use the screenshots in `shots/` or the files in `dl/` as product assets. They are for internal
  reference only.
- Their **source code**, including the sketch-frame generator in `sketch-*.js`. Write our own
  from the description above.
- Product copy and names: "Anti-Bot Pass", "verified human", "chirps", or their page texts.
- Exact composite layouts as a whole: don't clone their home page's three-card arrangement 1:1.
  Use the components and tokens in our own layouts.
