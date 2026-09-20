# Website — a multi-page prototype

A website is not one tall artboard. It is a set of pages that share a header, a footer and a world,
and that click through. Read reference/interface.md for how a page is designed; this file is what
makes several pages a site.

## Pages

Decide the pages from the subject, not from a template, and never fewer than three:

- A local business (cafe, gym, clinic, salon): Home, the thing they sell (Menu / Classes /
  Services), About or Story, Visit / Contact (address, hours, map placeholder as an SVG, booking).
- A product or SaaS: Home, Product or Features, Pricing, Docs or Resources, Contact or Sign-up.
- A person or studio: Home, Work (with 2–3 project pages if the brief has the material), About, Contact.
- A campaign or event: Home, Programme, Speakers or Line-up, Tickets, Venue.

Name each artboard with the page's name exactly as the navigation shows it ("Menu", not "menu-page").

## Order of work

1. design_new with the brief: the pages and one line on what each is for, the world, the tokens.
2. design_brand, then draw **Home** and design_verify it. The header, footer, type and colour
   decided here are what every other page inherits — do not draw page two until Home is clean.
3. Draw each remaining page as a full page, top to bottom, with the same header and footer markup
   (copy it verbatim, change only the active state). Verify each.
4. Read the whole set back once (design_read) and check the navigation names match the artboard
   names on every page.

## Links are the prototype

Every link to another page is `<a href="#page:Page Name">` with that artboard's exact name. The
canvas opens the page when it is clicked, and the export rewrites it to `page-name.html`, so the
zip is a working site. Links inside a page (to a section) stay `#section-id`. External links are
`href="#"` — nothing leaves the prototype.

Mark the current page in the navigation (`aria-current="page"`) so each artboard shows where it is.

## What every page carries

- The same header: wordmark, the page links, one primary action. Sticky if the page is long.
- The same footer: the essentials (address / hours / contact for a business; product, company and
  legal columns for a product), and nothing that pretends (no fake social icons drawn as glyphs).
- Real copy about the actual subject on every page. A Menu page has the menu with prices; a Pricing
  page has the tiers with what is in them; an About page has a story, not "lorem ipsum about us".
- A full height: a page is as long as its content and the artboard grows to fit it. Do not stop at
  the fold to make it fit 900 px.

## Motion

Read reference/motion.md. One hero moment on Home, reveals on at most two or three sections per page,
hover states everywhere they are expected, and the resting state of every animated element is its
final state so the still frame is the finished page.
