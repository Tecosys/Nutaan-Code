Generated interfaces fail in a recognisable way: three identical feature cards, a headline that could
belong to any company, uniform padding everywhere, and a gradient hero. The cure is committing to
constraints and writing real copy.

## Tokens first

Decide these before the first element and never improvise a value afterwards:

- **Spacing**: 4 8 12 16 24 32 48 64 96 128. Section padding 96–128, card padding 24–32, gaps 12–24.
- **Type**: 12 14 16 18 24 32 48 64. Body 16–18, never below 14. At most six sizes on a page.
- **Radius**: one value (8–16), half it for chips and inputs.
- **Shadow**: one depth. `0 1px 3px rgba(16,24,40,.08)` on light; on dark, a 1px border beats a shadow.
- **One typeface**, two or three weights. Inter, system-ui or similar.

Improvised values are the single loudest tell that no one designed this.

## Hierarchy

Scale, weight, colour and space — in that order of strength. A page with one clear focal point reads
instantly; a page where four things shout reads as noise.

- **Headline 48–64px, `line-height:1.05–1.15`, `letter-spacing:-0.02em` to `-0.035em`.** Large type
  set at default tracking is the most common amateur mistake — big text needs to be pulled tight.
- **Sub 18–20px at 1.5**, capped at ~65 characters. A full-width line of body text is unreadable.
- Body at 1.6. Headings tight, body loose — never the same leading for both.
- One primary button per view. Everything else is a ghost or a text link.

## Layout

- A real grid — 12 columns with a max width of 1200–1280 and a consistent outer gutter.
- **Vary section rhythm.** Alternate full-bleed and contained, 60/40 and 50/50, image-left and
  image-right. A page of identical stacked bands is the web equivalent of eleven identical slides.
- Align to a shared gutter. Ragged left edges down the page read as sloppy even when nothing is
  technically wrong.
- Whitespace is structure. Cramped sections look cheap; the fix is almost always more space around
  the thing that matters, not more content.

## Copy

Write about the actual product. "Build the future of work" and "Your all-in-one platform" are
averages of every headline ever written and say nothing.

- Headline: the specific promise. Sub: who it is for and what changes.
- Real names, real numbers, real product nouns in the UI. Never lorem ipsum, never "Feature One".
- Buttons say what happens: "Start free trial", not "Learn more".

## Depth and finish

Use current detail rather than 2015 defaults: soft layered shadows over hard drop shadows, a subtle
noise or gradient wash over a flat slab, real borders at `rgba(255,255,255,.08)` on dark surfaces.
Avoid the giveaways — full-width purple-to-blue gradient heroes, three equal cards with circle
icons, stock-photo boxes, and centred everything.

Imagery is inline SVG or CSS gradients — an artboard is self-contained, so a linked file is a broken
image.

## Responsiveness

If the user asks for responsive, design the breakpoints as separate artboards (1440, 834, 390) and
make them genuinely different layouts — a sidebar becomes a bottom bar, a 4-up grid becomes 1-up,
the headline drops to 32–36px. Shrinking a desktop layout is not a mobile design. On mobile, touch
targets are 44px minimum and the primary action sits in the lower third where a thumb reaches.

## Before you call it done

From the `design_verify` screenshot: is there one obvious focal point? Is the headline tight? Is
every spacing value on the scale? Are there at most six type sizes and one accent? Does the copy say
something only this product could say? Do sections vary, or are they all the same band?
