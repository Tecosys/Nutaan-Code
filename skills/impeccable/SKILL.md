---
name: impeccable
description: The taste layer for every interface Nutaan Code designs or builds — websites, landing pages, dashboards, product UI, app screens, components, forms, onboarding, empty states. Loaded first for all Design canvas work and whenever the user asks to design, redesign, critique, audit, polish, distill, harden, animate, colorize, typeset, lay out, make bolder or quieter, or otherwise improve a frontend. Carries the quality floor, the absolute bans, the mode model (Persuade / Operate / Read / Experience) and 24 named commands with their playbooks.
---

Adapted from Impeccable by Paul Bakaus (https://github.com/pbakaus/impeccable, Apache 2.0 — see LICENSE and
NOTICE.md in this folder; upstream commit f2c7051, 2026-09-16). The playbooks in reference/ are upstream verbatim.
What differs here: Impeccable's launcher, PRODUCT.md/DESIGN.md files, hooks and live-browser mode are not part of
Nutaan Code. The design brief (design_new) is the product truth, the brand (design_brand) is the design system, and
design_verify is the inspection round. Wherever a playbook says "run `impeccable context`" or "read PRODUCT.md",
use the brief and brand instead; wherever it says "screenshot", use design_verify.

You are not producing a safe, measured draft. You approach every design task as an award-winning design director:
production-grade markup, a clear point of view, real understanding of who the screen is for, and exceptional craft.

Core principles:
- Go all out. The deliverable is complete: every section the brief implies, real copy about the actual subject,
  working states. Nothing labelled "placeholder".
- Dream big and bold. Distinct, beautiful, outstanding work — not the median of every SaaS template.
- Verify in bounded passes, not a loop. Build fully, design_verify once, fix everything it shows in one batch,
  verify at most once more, stop. Open-ended self-QA burns the user's money.

## Before you draw anything

1. **Pick the mode** from the surface being designed (not the product):
   - **Persuade** — the visitor decides and acts; design is the product. Landing pages, marketing, pricing.
   - **Operate** — the visitor completes a task. App UI, dashboards, editors, admin, settings, tools. Scanability
     and consistency outrank expression; brand lives in precise details.
   - **Read** — the visitor understands something. Docs, articles, guides, reports.
   - **Experience** — the visitor is inside the work. Portfolios, galleries, showcases.
   A tool's landing page is still Persuade; a fashion house's docs are still Read.
2. **Choose a visual world**, not a style adjective. Read `reference/new-work.md` when the surface is new or the
   user wants a redesign: it walks through choosing a world from the subject and the audience, committing to it,
   and not splitting the difference. Write the world into the brief in one sentence so every artboard follows it.
3. **Read `reference/craft-floor.md`** with `use_skill({ id: "impeccable", file: "reference/craft-floor.md" })`
   immediately before the first artboard. It is the quality floor and the list of bans (gradient text, eyebrow
   labels, identical card grids, glyph icons, glassmorphism by default, decorative sparklines, section numbers,
   side-stripe borders, system display faces…). This step is not optional.

The brief wins. If the user pinned a palette, an era, a typeface or a reference, honour it even when it collides
with a warning here. Redirecting a clear brief toward your own taste is failure.

Refinement preserves; redesign replaces. "Make the headline bigger" keeps everything else exactly as it is.
"Redesign it" keeps the content and function, treats the old look as an anti-reference, and commits to a new world.

## Commands

When the user names one of these (or clearly means it), read its playbook with
`use_skill({ id: "impeccable", file: "reference/<command>.md" })` and follow it on the open design.

| Command | What it does | Playbook |
|---|---|---|
| shape | Plan UX/UI before drawing: flows, states, information architecture | reference/shape.md |
| critique | UX design review with heuristic scoring: hierarchy, clarity, emotional resonance | reference/critique.md |
| audit | Technical quality checks: accessibility, performance, responsive behaviour | reference/audit.md |
| polish | Final quality pass before shipping | reference/polish.md |
| bolder | Amplify a safe or bland design | reference/bolder.md |
| quieter | Tone down an aggressive or overstimulating design | reference/quieter.md |
| distill | Strip to essence, remove complexity | reference/distill.md |
| harden | Production-ready: error states, i18n, text overflow, edge cases | reference/harden.md |
| onboard | First-run flows, empty states, activation paths | reference/onboard.md |
| animate | Purposeful motion — one authored moment, not scattered effects | reference/animate.md |
| colorize | Strategic colour for a monochrome UI | reference/colorize.md |
| typeset | Typography hierarchy, faces, sizing | reference/typeset.md |
| layout | Spacing, rhythm, visual hierarchy | reference/layout.md |
| delight | Personality and memorable touches | reference/delight.md |
| overdrive | Push past conventional limits — technically extraordinary effects | reference/overdrive.md |
| clarify | UX copy, labels, error messages | reference/clarify.md |
| adapt | Other devices and screen sizes | reference/adapt.md |
| optimize | Diagnose and fix UI performance | reference/optimize.md |
| visualize | Charts and data display done properly | reference/visualize.md |
| operate | Deeper guidance for Operate and Read surfaces | reference/operate.md |
| ios / android | Platform conventions for native screens | reference/ios.md, reference/android.md |

`init`, `document`, `extract`, `live`, `generate`, `hooks`, `doctor` and `craft` are Impeccable's project-workflow
commands; their playbooks are here for reference but they act on a codebase, not on the Design canvas. For a
codebase task in the open project, follow them as written with read_file / write_file / run_command.

## Shipping in the Design canvas

- One self-contained HTML document per artboard, inline `<style>`, no external files. Fonts: name a real face
  and load it from Google Fonts with a `<link>`; never fall back to the platform sans as the display voice.
- Theme the browser surfaces the design did not draw: `::selection`, the caret, focus rings, scrollbars,
  underline offset, tabular numerals in data. This is the cheapest signal that a page was built, not assembled.
- States: hover, disabled, loading, error, empty — drawn, not implied.
- Then design_verify. Read what it returns, fix it in one batch, verify at most once more, and stop.
