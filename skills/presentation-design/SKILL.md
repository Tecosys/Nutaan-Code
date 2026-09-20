---
name: presentation-design
description: Design a slide deck, pitch, board review or conference talk that carries an argument instead of listing bullet points. Use before drawing any slide, deck or presentation artboard in the Design canvas.
---

A deck is an argument, not a document. The failure mode of a generated deck is a title, four
bullets, and a stock layout repeated eleven times — which is a memo someone pasted into slides.
Consulting decks look rigorous because the structure does the work before any styling starts.

## Write the storyline first

Before a single artboard, write the deck as a list of **action titles** — the sentence each slide
proves. Read those titles top to bottom: they must read as a coherent argument on their own. If
they don't, the deck doesn't either, and no styling will save it.

Answer first, in the title. The title is the finding, not the topic:

- ✗ "Q3 Revenue" — a label. It tells the reader nothing and makes them hunt.
- ✓ "Revenue grew 24% — entirely from enterprise renewals" — a claim the slide then proves.

**Maximum 15 words, never more than two lines.** Then 2–4 supporting points that back exactly that
claim. Anything that doesn't support the title belongs on another slide or in the appendix.

## Structure

```
1  Title             what this is, who it is for, the date
2  The answer        your conclusion, up front, before the evidence
3-n The argument     one idea per slide, 3-5 supporting arguments
   Close            what you want the room to decide or do next
   Appendix         the detail someone will ask about
```

**One idea per slide.** If a slide needs "and", it is two slides. A slide you cannot present in 60
seconds is too dense — split it.

## Typography

Slides are read from across a room, so everything scales up hard from web sizes:

- **Slide title**: 40–54px at 1920×1080. **Body**: 20–24px. **Labels and sources**: 14–16px.
  Nothing on a slide is ever under 14px — if it must be smaller, it belongs in the appendix.
- **One sans-serif typeface across the whole deck.** No serif title over a sans body, no per-slide
  font swap. Weight and size do the work.
- Set titles tight: `line-height: 1.15`, `letter-spacing: -0.02em`. Body copy breathes at 1.5.
- **Under ~40 words of body copy per slide.** A wall of text means you wrote a document.
- Bullets are fragments, not sentences, and never wrap to three lines. Six words beats sixteen.

## The invariant grid

Every slide uses the same margin and the same column grid, so the eye never re-orients between
slides. At 1920×1080:

- **Outer margin 96px** on all four sides. Nothing but a full-bleed image crosses it.
- **12 columns, 32px gutters** inside that. Two-column splits land on 6/6 or 8/4.
- **Title baseline in the same place on every slide.** This one rule does more for perceived quality
  than any other — when titles jump around, the deck reads as amateur even if each slide is fine.
- A consistent footer: page number, and the source line under any chart.

## Colour

- **3–4 colours in the entire deck**, and one of them is the accent.
- Structure — headers, rules, chart baselines, most bars — in brand or neutral grey.
- **The accent marks exactly one thing per slide**: the bar that proves the title, the line that
  matters, the number being argued about. If three things are accented, none of them is emphasis.
- Dark decks read well on a projector, light decks on a laptop. Commit to one and keep it.

## Every slide earns its layout

Vary the slide *type* to match what it says — a deck where all eleven slides share one layout is the
same failure as one where all eleven are different:

- **Statement** — one sentence, huge, lots of air. For the turn in the argument.
- **Big number** — one figure at 120–200px, with the comparison beside it.
- **Chart** — inline SVG with real paths, labelled axes, and the takeaway written as the title.
- **Two-column** — claim on the left, evidence on the right.
- **Comparison** — before/after or us/them, symmetrical, with the difference accented.
- **Timeline / process** — numbered steps on a single rule.
- **Quote** — a customer sentence at 32–40px with attribution.

Charts on slides are simpler than dashboard charts: fewer series, bigger labels, the point already
made in the title. Strip the legend when a direct label on the line will do.

## Filling the frame

A slide is fixed at 1920×1080 — there is no scrolling and no reflow. Every artboard must fill it:
the outermost element uses `min-height:100vh` with flex or grid so content is distributed, not
stacked at the top with a dead band underneath. Equally, nothing may run past the bottom edge; that
content is simply gone when it is presented.

Whitespace is not wasted space. A statement slide with one sentence and a lot of air is stronger
than the same sentence with three bullets added to fill it.

## Before you call it done

Read the action titles in order — do they argue? Then look at each screenshot from `design_verify`:

- Is the title a claim, under 15 words, on two lines at most?
- Is there exactly one idea on the slide?
- Is the title baseline in the same place as on the previous slide?
- Under 40 words of body?
- One accent, marking one thing?
- Does the content fill the 1920×1080 frame with nothing clipped?
- Could someone at the back read every character?

Fix what fails, verify again, and stop only when the deck would survive being presented.
