---
name: BitWorth
description: Your net worth, without the spreadsheet — mapped like an honest box, printed like a wrapper.
colors:
  paper: "#F6F1E6"
  washi: "#FCFAF4"
  kraft: "#DCC8A5"
  kraft-deep: "#C9B28A"
  kraft-rule: "#D9CCAE"
  ink-muted: "#6F5F4D"
  indigo: "#1E3A5F"
  indigo-deep: "#162B47"
  ink: "#3B2F2A"
  sage: "#5F7F66"
  vermilion: "#C73A2B"
  night: "#101A29"
  night-plate: "#182740"
  paper-on-night: "#F2ECDD"
typography:
  display:
    fontFamily: "'Shippori Mincho B1', 'Iowan Old Style', Georgia, serif"
    fontSize: "clamp(2.25rem, 5.5vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "0.01em"
  headline:
    fontFamily: "'Shippori Mincho B1', Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  small:
    fontFamily: "'Zen Kaku Gothic New', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Zen Kaku Gothic New', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.12em"
rounded:
  sm: "4px"
  md: "6px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-deep}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.indigo}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
  card:
    backgroundColor: "{colors.washi}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  chip-gain:
    backgroundColor: "transparent"
    textColor: "{colors.sage}"
    rounded: "{rounded.sm}"
  chip-loss:
    backgroundColor: "transparent"
    textColor: "{colors.vermilion}"
    rounded: "{rounded.sm}"
  number-chip:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.paper}"
    rounded: "{rounded.full}"
    size: "20px"
---

# Design System: BitWorth

## Overview

**Creative North Star: "The Contents Map"**

BitWorth is designed as an honestly-mapped box in the ekiben-wrapper tradition: warm paper
grounds, one deep ink that draws everything, vermilion seals that certify rather than decorate,
and a numbered diagram whose promise is that everything is exactly where the wrapper says it is.
The product's privacy stance (you enter every number yourself) becomes the world's honesty
stance: the map is always true, absences stay visible, nothing is invented.

The system is a print world, not a screen world wearing print clothes. Illustration is
woodblock-flavored ink line art, always; photography, never. Color is structural: indigo is
the ink, vermilion is the stamp, sage is growth, kraft is the wrapping. The canonical rendition
is paper-light; dark mode is the same print run at night — the ink plate itself, cream type on
deep indigo-black, seals still vermilion.

**Key Characteristics:**
- Warm paper grounds with visible texture; flat, outlined surfaces; no glow, no glass, no gradient chrome
- One ink (indigo/ink brown) for type, borders, and illustration alike
- Vermilion reserved for seals, numbered markers, section kickers, and negative amounts
- Numbers are the heroes, set in a carved Mincho display face
- Empty states are honest absence: dotted outlines and plain words

## Colors

A five-ink print palette on paper: two grounds, one ink, one stamp, one growth green.

### Primary
- **Hida Indigo** (#1E3A5F): the ink. Headings, primary buttons, borders, illustration linework, chart lines. Hover deepens to **Indigo Deep** (#162B47).

### Secondary
- **Seal Vermilion** (#C73A2B): the stamp. Hanko seals, numbered compartment chips, section kickers, dotted rules, liability/negative amounts, destructive actions. Never a large fill.
- **Pine Sage** (#5F7F66): growth. Positive deltas, gains, on-track verdicts. Always paired with a direction glyph or word — color never carries meaning alone.

### Neutral
- **Paper** (#F6F1E6): page ground, light theme.
- **Washi** (#FCFAF4): card and surface ground — a brighter sheet laid on the paper.
- **Kraft** (#DCC8A5): bands, dividers, muted fills, disabled states; **Kraft Deep** (#C9B28A) for borders on kraft; **Kraft Rule** (#D9CCAE) is the standard 1px border/divider ink on paper (`--border`).
- **Ink Brown** (#3B2F2A): body text on paper; **Ink Muted** (#6F5F4D) for secondary text (`--muted-foreground`).
- **Night** (#101A29) / **Night Plate** (#182740): dark-theme page and card grounds — the ink plate itself.
- **Paper-on-Night** (#F2ECDD): type and linework in dark theme.

### Named Rules
**The Seal Rule.** Vermilion behaves like a rubber stamp: small, saturated, certifying. If a vermilion element is wider than a thumb, it has stopped being a seal.
**The One Ink Rule.** Illustration, borders, and type share the same ink colors. Nothing is ever gray-on-gray; muted content tints toward kraft, not gray.

## Typography

**Display Font:** Shippori Mincho B1 (with Georgia fallback) — a carved Japanese Mincho whose Latin has woodblock confidence.
**Body Font:** Zen Kaku Gothic New (with system sans fallback) — warm print gothic, excellent small-size legibility.

**Character:** A wrapper printed by a careful regional maker: carved, confident display letters over quiet, evenly-set gothic notes. Numerals are the largest thing on any surface that has them.

### Hierarchy
- **Display** (800, clamp(2.25rem–4.25rem), 1.12): the net worth figure and the landing hero. Tabular, lining numerals (`font-variant-numeric: tabular-nums`).
- **Headline** (700, 1.5rem, 1.25): card titles, section headings, in Mincho.
- **Title** (700, 1.125rem, 1.3): sub-cards, dialog titles, in Mincho.
- **Body** (400, 1rem, 1.65): Zen Kaku Gothic New; measure 65–75ch.
- **Small** (400, 0.875rem, 1.5): secondary rows, table cells, control labels — the workhorse in-card size.
- **Label** (700, 0.75rem, 0.12em tracked, uppercase): section kickers, table headers, chips. Kickers are vermilion; table headers are ink at 60%.

### Named Rules
**The Numbers-Are-Cargo Rule.** Financial figures always render tabular-lining; a figure and its currency never break across lines; deltas always carry sign, arrow, and percentage.

## Layout

Content sits on sheets: a centered container (max-w-3xl on the dashboard, max-w-6xl on the landing) with generous paper margins (px-4 mobile, px-8 desktop). Section kickers use the wrapper grammar — vermilion tracked caps, then a dotted vermilion rule running to the right edge. Cards stack with 24px gaps; groups within cards use 8–16px. More space above a heading than below it. Mobile shows one sheet at a time; the compartment grid restacks to a single column, and tables reflow into cards (incumbent behavior, preserved).

## Elevation & Depth

Flat print, layered paper. Surfaces carry no blur shadows; depth comes from outlines and paper tone (washi on paper, plate on night). The one exception: floating layers (dialogs, popovers, dropdown menus) sit on the page like a second sheet — a hard offset shadow (`box-shadow: 4px 4px 0 rgba(59,47,42,0.18)`), like a card lifted off the stack.

### Named Rules
**The Flat Print Rule.** No blur shadows, no glow, no glass. If an element needs separation, give it an outline or a different paper tone; if it truly floats, give it the hard paper offset.

## Shapes

Printed-plate geometry: rectangles with small radii (6px cards, 4px buttons/inputs/chips), 1.5px indigo outlines on interactive plates, 1px kraft rules elsewhere. Seals are circles. Numbered markers are small filled vermilion circles with paper numerals. Dotted rules (2px dot, 6px gap, vermilion at 50%) divide sections. No pill buttons except chips and seals.

## Components

### Buttons
- **Shape:** printed plate, 4px radius
- **Primary:** filled Hida Indigo, paper text, 12px × 28px padding; hover deepens to Indigo Deep and nothing moves
- **Secondary:** 1.5px indigo outline on transparent, indigo text; hover fills with indigo at 8%
- **Destructive:** vermilion outline, vermilion text; hover fills vermilion, paper text
- **Focus:** 2px indigo ring offset 2px

### Chips (deltas, tags)
- **Delta chips:** transparent with 1px current-color border, sage (gains) or vermilion (losses), always sign + arrow + value
- **Season chips (labels like "SPRING ONLY"):** kraft fill, ink text, 4px radius

### Cards / Containers
- **Corner Style:** 6px
- **Background:** washi (light) / night plate (dark)
- **Border:** 1px kraft-deep (light) / 1px paper-on-night at 15% (dark); the *active or leading* card earns a 1.5px indigo border
- **Shadow:** none (The Flat Print Rule)
- **Internal Padding:** 24px, 16px on mobile

### Inputs / Fields
- **Style:** washi ground, 1px kraft-deep border, 4px radius, ink text
- **Focus:** border becomes 1.5px indigo, plus the standard focus ring
- **Error:** vermilion border and a vermilion note naming the problem and the recovery

### Navigation
- **Kiosk header:** a paper band with the BitWorth seal + wordmark left, ink links right, closed below by a 2px indigo rule. Active link is indigo with a 2px indigo underline offset; hover is indigo. Mobile collapses to the incumbent menu with the same grammar.

### The Contents Map (signature)
The category/asset breakdown rendered as a numbered diagram: each row/compartment carries a small vermilion number chip, its name in body gothic, its figure in tabular numerals. The map's numbers correspond to visible compartments wherever a spatial rendering exists (landing hero, assets summary). Emptied compartments remain visible — dotted kraft outline, "empty" in plain words (The Honest Absence Rule).

### The Dated Seal (signature)
"Save snapshot — stamp the month" is the act of stamping: the primary plate button is the seal-in-waiting, and on success a vermilion circular seal bearing the month and year lands in its place (the `stamp-land` motion, 350ms ease-out, reduced-motion safe) before the page refreshes. The lead net-worth card wears a kraft wrapper band across its top, bearing the seal glyph — the box's strap.

## Do's and Don'ts

### Do:
- **Do** set every financial figure in tabular lining numerals with its currency attached.
- **Do** draw icons and illustration as single-ink line art (1.5–2px stroke, indigo or current ink).
- **Do** keep the paper texture subtle — it should be felt at rest, invisible while reading.
- **Do** pair every color-coded meaning (sage gain, vermilion loss) with a glyph or word.
- **Do** keep dark mode a true night print: same layout, ink plate grounds, cream type, vermilion seals unchanged.

### Don't:
- **Don't** use photography, glow, glass/blur decoration, or gradient fills anywhere.
- **Don't** use blur shadows; floating layers use the hard paper offset (The Flat Print Rule).
- **Don't** let vermilion carry large fills or body text (The Seal Rule).
- **Don't** use gray; muted content tints kraft/ink (The One Ink Rule).
- **Don't** bridge gaps in charts or invent placeholder data; absence renders as honest absence.
