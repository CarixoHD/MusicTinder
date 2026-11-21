# DESIGN.md — visual direction

The PRD's taste notes win wherever they speak: **Apple Music / Linear / Vercel-grade
restraint** — near-black canvas (`#08090a` family), album artwork as the only
saturated colour, translucent glass chrome, 1 px hairline borders, one accent used
like a flashlight, SF-style system type. Everything below enforces that. If two
screens disagree, these tokens win.

The product is a phone-shaped, one-handed, quiet tool. No hero moments, no
gradients-as-decoration, no shadows doing work borders could do. The card is the
one memorable element; everything around it is quiet and disciplined.

## Type

System stack only — no webfont, it costs startup and reads off-brand:

```
-apple-system, "SF Pro Text", Inter, system-ui, "Segoe UI", Roboto, sans-serif
```

Tabular numerals (`font-variant-numeric: tabular-nums`) for years and counts.
Optical tracking: −0.5 px on display sizes, 0 on body, +0.2 px on the 11 px
metadata labels. Sentence case everywhere; no all-caps labels, no letterspaced
eyebrows.

| Token | Size | Weight | Use |
| --- | --- | --- | --- |
| `text-display` | 34/38 | 700 | card title (1 line, ellipsis) |
| `text-title` | 22/26 | 600 | screen titles |
| `text-body` | 15/20 | 400 | card creator, seed names, list rows |
| `text-meta` | 13/16 | 500 | tags, chips, "because you like X" |
| `text-micro` | 11/14 | 500 | statuses, counters |

## Colour tokens (CSS custom properties, `src/ui/tokens.css`)

Dark is the native theme; light is an inversion of the same structure, not a
separate palette.

| Token | Dark | Light |
| --- | --- | --- |
| `--bg-canvas` | `#08090a` | `#fafaf8` |
| `--bg-glass` | `rgba(18,20,24,.72)` (blur 24 px) | `rgba(255,255,255,.72)` (blur 24 px) |
| `--bg-elevated` | `#131519` | `#ffffff` |
| `--bg-subtle` | `#1b1d22` | `#f0f0ee` |
| `--border-hairline` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.08)` |
| `--border-strong` | `rgba(255,255,255,.16)` | `rgba(0,0,0,.16)` |
| `--text-primary` | `#f7f8f8` | `#16181d` |
| `--text-secondary` | `#9ba0a6` | `#565b63` |
| `--text-tertiary` | `#858b94` | `#686d74` |
| `--accent` | `#8b8ff0` | `#4f56c7` |
| `--accent-subtle` | `rgba(139,143,240,.14)` | `rgba(79,86,199,.10)` |
| `--like` | `--accent` | `--accent` |
| `--danger` | `#e5654f` | `#b3402c` (unused in v1 interactions; reset only) |

Every text token clears WCAG AA (≥ 4.5:1) against both `--bg-canvas` and
`--bg-elevated` in dark and light, so 13 px meta text is never decoration.

The accent (a quiet iris) is the single non-neutral tint: liked state, active chip,
focus rings, the one progress affordance. It never appears on more than one
element per viewport region. It is deliberately distinct from typical album-art
hues (warm reds/oranges/blues) so it never fights the artwork. **Artwork is the
only saturated colour in the interface.**

`theme-color` metas: `#08090a` / `#fafaf8` with `media="(prefers-color-scheme)"`
pairs, switched live by `ui/theme.ts` when the user overrides.

## Space, radius, layout

- Space scale (4 pt base): `--space-1..10` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 56.
- Radius scale: `--radius-card 16`, `--radius-sheet 24` (top corners), `--radius-control 10`,
  `--radius-pill 999`. Artwork uses `--radius-card` with no border on the image itself.
- Hairline borders everywhere instead of shadows; one soft shadow reserved for the
  dragged card (`0 8px 32px rgba(0,0,0,.35)` dark / `.12` light).
- Single column, centered, `max-width: 480px`. `100svh` viewport, `viewport-fit=cover`,
  safe-area insets on bottom nav and top header.
- One screen visible at a time; bottom tab bar (Discover, Liked, Settings as
  sheet) in `--bg-glass`. Content never sits under chrome: pad with the nav's height.

## Core components

- **Recommendation card** (the hero). Full-bleed-width square artwork on
  `--bg-elevated`, fixed aspect-ratio + neutral placeholder (no layout shift on load).
  Below, left-aligned: title (`text-display` ellipsized), creator `--text-secondary`,
  year + ≤ 2 chips (`text-meta`), the quiet `because you like X` line in
  `--text-tertiary`. Play/pause as a 48 px glass circle overlapping the artwork's
  lower-right corner; sound state shown by icon **and** a 2 px progress hairline,
  never colour alone. Like/skip as two 56 px glass buttons under the card. Card
  corner radius `--radius-card`, hairline border, dragged state lifts with the
  shadow above. A "no sample" card shows a muted waveform glyph — deliberate, not broken.
- **Deck-end state**: centered `text-title` line ("That's everything in this
  direction"), secondary line, two quiet buttons: "Fresh deck" (primary) and
  "Change seeds" (secondary). No skeleton graveyard, no sad illustration.
- **Buttons**: primary = `--accent` background, canvas-coloured text, `--radius-control`;
  secondary = `--bg-subtle` + hairline border; all ≥ 44 px tall; pressed state
  = scale 0.98 (spring), never an opacity flicker.
- **Chips**: pill, `text-meta`, unselected = `--bg-subtle` + hairline; selected =
  `--accent-subtle` + 1 px accent border + accent text. Multi-select wraps in a grid.
- **Search input** (Setup pickers): 52 px, `--bg-subtle`, hairline, results in a
  glass list sheet with 56 px artwork thumbs; unresolved seed → inline flag row in
  `--danger`, not a toast.
- **Liked list rows**: 56 px thumb (fixed box, placeholder), title/creator,
  year `--text-tertiary`, external-link affordance; whole row is the tap target.
- **Empty states** (Liked empty, deck cold): one sentence in `--text-secondary`
  naming the action ("Swipe a few cards and your finds collect here"), plus the
  button that does it.
- **Glass chrome**: header and bottom bar use `--bg-glass` + `backdrop-filter:
  blur(24px)` + hairline top/bottom border — the Apple Music material, nothing
  more. Backdrop-filter is the only blur in the app.

## Motion language (150–350 ms, spring-like, transform/opacity only)

- Screen change: 240 ms cross-fade + 12 px rise via View Transitions API;
  ≤120 ms cross-fade fallback; instant under reduced motion.
- Card drag: 1:1 with the finger, rotate ±8° max around the drag delta; release:
  Motion spring (`stiffness ~320, damping ~32`) — flyout ≥ threshold, settle
  otherwise. Reduced motion: no rotation, no fling — like/skip confirm via a
  120 ms cross-fade plus an on-card like/skip label that also makes state legible
  to non-colour senses.
- Liked list: 30 ms-per-row stagger reveal, once per entry; off under reduced motion.
- Swipe commit feedback: next card scales 0.96 → 1.0 spring; the promoted card
  arrives, it doesn't slide.
- No looping/ambient animation anywhere. Nothing moves that the user didn't cause,
  except the single load-in of the first card.
