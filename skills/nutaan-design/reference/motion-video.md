# Motion video — a scene that renders to a file

A motion artboard is a timed scene, not a page. Time is the layout: the same HTML, but every element
enters, holds and leaves at an exact moment on one shared clock. The exporter asks the scene for
frame after frame by time (`__seek(ms)`) and encodes them, so the rule that makes everything work is:
**the still at any instant must be a finished frame, and every movement must be a CSS animation.**

## The frame

- preset `video` (1920×1080) for launch videos, product films, feature reveals; `vertical`
  (1080×1920) for reels and stories.
- `<body data-duration="12000">` — the scene length in ms. 8–20 s for a launch video; nobody watches
  a 45 s SaaS animation.
- `html, body { width: 1920px; height: 1080px; overflow: hidden; margin: 0 }` and everything
  positioned inside that box. Nothing scrolls, nothing depends on the viewport.
- Safe margins: 96px all round; text never closer than that to the edge.
- Type at video scale: headline 96–140px, body 32–40px, small labels 24px. One typeface, loaded from
  Google Fonts with a `<link>` (the exporter waits for it).

## The timeline

Every movement is `animation:` with `animation-fill-mode: both` and an **absolute** `animation-delay`
counted from the scene's start — never a delay relative to another element, never JavaScript timers,
never `transition` triggered by script. The frame at t = 4.2 s must be the same whenever it is asked
for, and with keyframes + absolute delays it is.

Write the scene as shots on a paper timeline first, then code it:

```
0.0–1.6   Shot 1  wordmark rises, tagline fades in
1.6–4.5   Shot 2  the problem in one line, three words landing one after another
4.5–9.0   Shot 3  the product: the take plays inside a device frame, a caption per feature
9.0–11.0  Shot 4  the claim, big
11.0–12.0 Shot 5  wordmark + URL, hold
```

One shot is one absolutely positioned full-frame `<section class="shot">`. It fades/moves in at its
start, holds, and leaves at its end — two keyframe animations or one with a hold in the middle:

```css
.shot { position: absolute; inset: 0; opacity: 0; animation-fill-mode: both; }
.s2 { animation: shot 2.9s linear 1.6s both; }
@keyframes shot { 0% { opacity: 0 } 8% { opacity: 1 } 92% { opacity: 1 } 100% { opacity: 0 } }
.s2 .word { opacity: 0; transform: translateY(40px); animation: rise .5s cubic-bezier(.22,1,.36,1) both; }
.s2 .word:nth-child(1) { animation-delay: 1.8s } .s2 .word:nth-child(2) { animation-delay: 2.0s } .s2 .word:nth-child(3) { animation-delay: 2.2s }
@keyframes rise { to { opacity: 1; transform: none } }
```

Easing: ease-out (`cubic-bezier(.22,1,.36,1)`) for things arriving, ease-in for leaving, `linear`
only for holds and for anything that must be exact (a progress line, a counter). 300–600 ms for an
entrance, 150–300 ms for a small state change, 600–900 ms for the one big move per scene.

Motion vocabulary that reads as designed: rise 24–40px with fade; scale from 0.96; a wipe with
`clip-path: inset(0 100% 0 0)` → `inset(0)`; a line drawing in with `stroke-dashoffset`; a number
counting up (`@property --n` with `counter-reset` or a stepped animation over a list of values);
a device frame sliding up 60px while its screen fades in. Avoid: bouncing (`elastic`), spinning,
rainbow gradients, more than one thing moving per shot, and identical fade-ups on everything.

## The product — a real screen recording

`design_takes` lists the screen recordings made in Demo Studio. Put one in the scene with:

```html
<video src="{{take:Onboarding demo}}" data-start="4500" muted playsinline></video>
```

`data-start` is the scene time (ms) at which the take begins playing from its own 0:00; before that
it is hidden. Size it inside a device or browser frame (`border-radius: 18px; box-shadow: 0 40px
120px -30px rgba(0,0,0,.7)`), with the frame entering as its own animation. The exporter seeks the
take frame-accurately, so a take is as reliable as any keyframe. Never fake a product screen with a
grey box when a take exists — ask design_takes first.

No take? Draw the product as real UI (a small, true version of its screen in HTML) and animate one
interaction inside it — a cursor moving, a toggle switching, a row appearing.

## Sound, captions, brand

The file is silent — say so, and put the words on screen. Brand colours from design_brand; the
wordmark from `{{logo}}` where it is set. Keep a 1-second hold at the end with the name and URL.

## Ship

1. design_artboard with preset `video` (or `vertical`), then design_verify: the still it returns is
   the frame at rest (all animations at their end state), so the last shot must read as a finished
   frame. Fix what it reports.
2. design_export_video. It renders every frame (30 fps by default) and encodes a file into the
   user's Videos folder; the chat shows the video. Tell the user its length and where it is.
3. Changes are cheap: design_update the scene and export again.
