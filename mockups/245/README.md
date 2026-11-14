# Mockups for #245 (owner-approved: Option C, 14 Nov 2026)

Reference only. This branch is never merged.

- `*.png`: the boards, rendered at 2x.
  1. Option C (icon blob) on a phone, 390 px: every lead kind, one lead opened with a ⚠, the round picker on All.
  2. Option C on a laptop, 1024 px, with the suspect card and a key of the lead kinds.
  3. The round picker at 360 px: (1) opens on the latest round with its snapshot card, (2) swiped back with R3 picked, the "latest" tag kept on R7, (3) All.
  4. The `/dev/gallery` strip: per kind, the strong swatch (hatched), the blob and the name.
  5. Context, tone and the token table (the same table is in the issue).
  - `x-rejected-*`: options A and B, kept only for reference. Don't build them.
- `source/*.html`: standalone HTML for the boards, for exact sizes, gaps and colours. They load Pangolin and Inter from `apps/web/src/fonts` only if you copy those files next to them; otherwise system fonts stand in. Build the real thing from `SketchFrame`, the shared kit and theme tokens, not from this inline CSS.

The issue (#245) is the spec. Where a board and the issue disagree, the issue wins.

To fetch from an agent without a browser:

    git fetch --depth 1 origin mockups/245
    git show FETCH_HEAD:mockups/245/1-option-c-phone-390.png > /tmp/245-1.png
