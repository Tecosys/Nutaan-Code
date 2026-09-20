# Motion

Motion is the last thing added and the first thing that reads as cheap when it is wrong. One authored
moment beats twenty fades. Read impeccable's reference/animate.md for the taste; this file is how to
ship it inside an artboard.

## Two layers

1. **CSS first.** Hover, focus, pressed, open/close, the hero's entrance — all CSS `transition` and
   `@keyframes`. It runs in the canvas, in the export, offline, and with scripts off.
2. **Motion (motion.dev) for what CSS cannot do:** scroll-linked reveals, staggered lists,
   springs, sequences. Load it from the CDN as an ES module and treat it as an enhancement: the
   page must be complete and still with it missing.

```html
<script type="module">
  import { animate, inView, stagger, scroll } from "https://cdn.jsdelivr.net/npm/motion@12/+esm";

  // Reveal sections as they enter — once, from an already-visible default (opacity .001, not 0).
  inView("[data-reveal]", (el) => {
    animate(el, { opacity: [0.001, 1], y: [16, 0] }, { duration: 0.55, ease: [0.22, 1, 0.36, 1] });
  }, { margin: "0px 0px -12% 0px" });

  // Stagger a list or a grid of cards.
  inView(".menu li", (li) => {
    animate(li, { opacity: [0.001, 1], y: [12, 0] }, { duration: 0.45, delay: stagger(0.06) });
  });

  // Scroll-linked progress (a header line, a parallax figure). Keep the range small.
  scroll(animate(".hero-figure", { y: [0, -40] }), { target: document.querySelector(".hero") });
</script>
```

Only the `motion` module may be loaded from outside the artboard; everything else stays inline.
Pin the major version (`motion@12`), never `@latest`.

## Rules that hold

- **Durations:** 150–250 ms for hover and pressed states, 300–500 ms for entrances, 500–800 ms for
  one hero moment. Nothing on a page takes a second.
- **Easing:** ease-out for things arriving (`[0.22, 1, 0.36, 1]`), ease-in for things leaving,
  springs only for direct manipulation (drag, toggle). Never `linear` for UI, never `ease-in-out` for
  entrances.
- **One authored moment per page** — the hero, the number counting up, the product turning. Every
  other motion is functional: state feedback, reveal on scroll, layout settling.
- **No identical entrance on every section.** If every block fades up 20 px the page reads as a
  template. Vary or omit.
- **Transform and opacity only** for anything that animates continuously; `blur`, `clip-path`,
  `backdrop-filter` and shadows are allowed for a single moment when they stay smooth.
- **Reduced motion:** wrap continuous or large motion in
  `@media (prefers-reduced-motion: no-preference)`, and in JS check
  `matchMedia("(prefers-reduced-motion: reduce)").matches` before calling `animate`.
- **Never animate an image on hover** (directly or through its parent); give the container the
  feedback.
- **The canvas is a still.** design_verify screenshots the settled state. Set every animated element's
  resting style to its final state so the still frame is the finished page, not a page waiting to
  fade in.

## Where it belongs by kind

- **Website / landing (Persuade):** one hero moment, scroll reveals on 2–3 sections at most,
  hover on cards and buttons, a sticky header that condenses.
- **App UI / dashboard (Operate):** state feedback only — 150–250 ms. Numbers may count up once on
  load; charts may draw their line once. Nothing moves while someone is reading data.
- **Mobile:** touch feedback under 150 ms, sheet and tab transitions 250–300 ms, spring on drag.
- **Slides, documents, social, email:** none. These are stills.
