---
name: nutaan-design
description: How Nutaan Code turns a request into a design — reading what the user actually asked for (their words, any screenshots or images they attached, the project that is open), asking one question when the subject is genuinely unclear, writing the brief, then following the playbook for the kind being made (website, interface, mobile, dashboard, presentation, document) and adding motion where it belongs. Loaded for every Design canvas request, after impeccable.
---

impeccable is the taste; this is the method. Read it in full, then the playbook for the kind.

## 1. Read the request before designing anything

The request is the user's words plus everything attached plus what is already open. Read all three.

**The words.** Find the subject (what is this for, who uses it), the kind (a site, a screen, a
deck…), any pinned facts (a name, colours, a typeface, a reference, copy that must appear) and any
constraint (must be dark, must fit one page, must match the app). Pinned facts win over your taste.

**Attached screenshots and images.** Look at each one and say to yourself what it shows before
deciding what to do with it. An image is one of four things — decide which, and if the words do
not say, the picture usually does:
- **Recreate:** a screenshot of an existing screen to be rebuilt as an editable artboard. Reproduce
  its structure, content and hierarchy faithfully; improve craft, not intent.
- **Reference:** "like this" — a style, a layout, a mood to borrow. Take the world (type, colour,
  density, tone), not the content.
- **Redesign:** their current screen, to be made better. Keep every feature, every piece of copy
  and every function it has; change the design.
- **Material:** a logo, a photo, a chart, a product shot to be placed in the design.
Never design something *about* what the picture shows. A screenshot of an app called Nutaan Code
is a screenshot of Nutaan Code to recreate, reference or redesign — it is not a request to invent
"a Nutaan product". If the model cannot see images, say so in one line and ask what it shows.

**The open project.** When the request refers to "this project", "our app", a screen, a page, a
component or a feature by name, or asks for a design that must match something that exists —
study the codebase first, with the ordinary tools, before design_new:
- list_dir the source; search_files for the screen or feature by its name and route;
- read_file the screens, layouts, components, tokens/theme/CSS variables, and copy strings it uses;
- read the README or docs for what the product is and who it is for.
Design from what is actually there: the real names, the real fields, the real navigation, the
real data shapes, the existing colours and type. Say in the brief which files you drew from.
"Use this design to build" hands the artboard back to the code side, so a design that matches the
project is one that can be built without translation.

## 2. Ask one question, or none

Ask **before** design_new, in one short message, and stop — only when the subject itself is
unclear, meaning different readings would produce different designs:
- the words and the image disagree about what is wanted;
- "a dashboard" with no hint of for whom or about what;
- a redesign request where you cannot tell which screen is meant.
Ask one focused question with two or three concrete options ("Is the screenshot the thing to
recreate, or a style reference for something new?"). Do not ask about anything you can decide
well yourself — palette, typeface, page count, layout, copy. Those are your job; the user can
change them afterwards in the canvas. Never ask more than once per request.

## 3. Write the brief

design_new carries the brief that every later step reads. In it, in order:
subject and audience · the mode (Persuade / Operate / Read / Experience) · the visual world in one
sentence · the pages or screens and what each is for · the token set (spacing scale, type scale of
at most six sizes, one radius, one shadow depth, one typeface) · the copy that must appear · what
the images attached are and how they are used · which project files it draws from, if any.

Then design_brand: use the brand if set; otherwise pick a palette that fits the subject and save it
with `set` so it stays with the design. Do not stop to ask about colours.

## 4. Follow the playbook for the kind

Read it with `use_skill({ id: "nutaan-design", file: "reference/<kind>.md" })`:

| Kind | Playbook |
|---|---|
| Website (multi-page prototype) | reference/website.md, then reference/interface.md |
| UI mockup, landing page, mobile screen | reference/interface.md |
| Dashboard, admin, metrics | reference/dashboard.md |
| Slide deck | reference/presentation.md |
| Document, report, research paper | reference/document.md |
| Anything that moves | reference/motion.md — after the page is designed, not before |

## 5. Ship

One self-contained HTML document per artboard. design_verify each one, fix what it reports in one
batch, verify once more at most, stop. Then one line to the user on what was made — and, if a
question was skipped because you decided it yourself, name the decision so they can change it.
