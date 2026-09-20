Most generated dashboards fail the same way: twelve identical tiles in a uniform grid, a rainbow of
chart colours, numbers with no comparison, and no answer to "so what?". Fix that by deciding the
question first and letting the layout follow it.

## Decide before you draw

Write these down in the brief, then design to them:

1. **Who opens this, and what do they do next?** An ops dashboard that triggers a shift change looks
   nothing like a monthly exec review. Name the decision.
2. **What is the one number that decides it?** That is the hero. Everything else supports it.
3. **Compared to what?** A number alone is noise. Every metric ships with a comparison — vs last
   period, vs target, or vs a sparkline. `$48.2K` says nothing; `$48.2K ▲ 12.4% vs last month`
   is a fact someone can act on.

## The zones

Eye-tracking on dashboards shows an F-pattern, so the grid is not decorative — it is the reading
order. Top-left is the most expensive real estate in the design; spend it on the hero, never on a
logo lockup or a filter bar.

```
┌──────────────────────────────────────────┐
│  nav / title            filters · updated│   thin, quiet, never the focus
├──────────────────────────────────────────┤
│  HERO METRIC  │  KPI  │  KPI  │  KPI     │   status: where are we right now
├──────────────────────────────────────────┤
│  primary chart (≈2/3)   │ secondary (1/3)│   trend: how did we get here
├──────────────────────────────────────────┤
│  table / breakdown / activity            │   detail: which rows caused it
└──────────────────────────────────────────┘
```

**5 to 9 metrics on the screen.** Past about a dozen, people stop reading and the dashboard becomes
wallpaper. If you have more, that is a second view, not a denser grid.

**Break the uniform grid.** The single clearest tell of a generated dashboard is every tile being
the same size. The hero tile spans two columns or carries a bigger number; the primary chart is
visibly wider than the secondary one. Intentional variation is what hierarchy *is*.

## Numbers

- Tabular figures (`font-variant-numeric: tabular-nums`) so columns line up and digits do not jitter.
- Round to the decision: `$48.2K`, not `$48,231.77`, unless someone reconciles to the cent.
- Right-align numeric table columns, left-align text ones. Always.
- Deltas carry direction *and* meaning: ▲ green when up is good, ▲ red when up is churn. Never let
  the arrow alone carry it — colour-blind readers lose the whole signal, so keep the sign or word.
- Timestamp the data. `Updated 4 min ago` is what makes a dashboard trustworthy; without it people
  assume it is stale and go ask someone.

## Charts

Match the chart to the question, not to variety:

| Question | Chart |
|---|---|
| How is it moving over time? | line, or area when volume matters |
| How do these compare? | horizontal bars, sorted by value |
| What is it made of? | stacked bar — a donut only for 2–4 parts |
| Where do people drop out? | funnel or step chart |
| Is this dense over two axes? | heatmap |

Draw them as **inline `<svg>` with real `<path>`, `<rect>`, `<line>` and `<text>`** — computed
coordinates, a baseline, gridlines and axis labels. Never an image placeholder, never a grey box
captioned "chart". Bars sorted by value beat alphabetical every time; a 3D chart or a pie with nine
slices is always wrong.

Gridlines are 1px and barely visible — `rgba(255,255,255,0.06)` on dark, `#eef1f5` on light. The
data is the ink; the scaffolding is not.

## Colour

Semantic colour only, and sparingly:

- **One accent** — the brand colour — for the primary series and nothing else.
- **Neutral greys** for every other series, all chrome, all gridlines, all labels.
- **Green / amber / red** reserved strictly for good / at-risk / bad. Never use red because it looks
  nice in a chart; a reader parses it as a problem.

A dashboard where six tiles are six different colours has no hierarchy — colour has stopped meaning
anything. If everything is highlighted, nothing is.

## Tokens

Pick the scale before the first tile and then never deviate — this is the difference between a
design and a guess:

- **Spacing**: 4 8 12 16 24 32 48 64. Every margin, padding and gap is one of these.
- **Type**: 11 12 14 16 20 28 40 56. Labels 11–12, body 14, tile titles 14–16, KPI numbers 28–40,
  hero 40–56. At most six sizes on the screen.
- **Radius**: one value for tiles (10–14px is current), half it for inner chips. Not four values.
- **Elevation**: on dark, a 1px border plus a near-black panel does more than any shadow. On light,
  one soft shadow (`0 1px 3px rgba(16,24,40,.08)`), used at one depth.
- **One typeface.** Inter, system-ui or similar. Weight and size carry hierarchy, not a second font.

## Before you call it done

Look at the screenshot from `design_verify` and check:

- Can you name the hero metric in under two seconds? If your eye wanders, the hierarchy failed.
- Does every number have a comparison?
- Are the charts real SVG with labelled axes, or decoration?
- Is there exactly one accent colour, with greys everywhere else?
- Is every gap on the spacing scale, and do the tile edges line up down a shared gutter?
- Are there fewer than ten metrics?
- Is the bottom of the artboard filled, with nothing clipped at the right?

Fix what fails, verify again, and only stop when the picture would pass in a real product review.
