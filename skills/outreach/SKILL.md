---
name: outreach
description: Run an outreach campaign end to end from one instruction — define the ICP, find the people (a list the user gives, a search, or LinkedIn in the browser), research each one, write a personalised message per person, put every draft through outreach_review for the user's approval, then send the approved ones one at a time through the built-in browser and log each in the campaign file. Use for "message 100 ICPs", "reach out to", "LinkedIn/cold outreach", "personalised DMs/emails", "find leads and contact them", "follow up with everyone who…".
---

An outreach campaign is research, writing and sending, in that order, with the user in the middle.
The work that makes a message land is the research; the sending is the easy part and the only part
that can do damage, so it is gated. Never send anything that has not come back from outreach_review.

## 0. Before anything: the campaign log

`outreach_history` with the campaign name (or without, to list campaigns). It tells you who has
already been contacted, so nobody gets the same message twice, and how many were sent today.
**Daily cap: 25 sends per campaign per day on LinkedIn, 40 for email.** Past the cap, draft and
queue; do not send. Say so.

## 1. The ICP, in one paragraph

From the user's words (and memory_read if they have described their product or customers before),
write down: who the person is (title, seniority), what company (size, sector, geography, stack), the
trigger that makes now the moment (hiring, a launch, a funding round, a tech they use, a post they
wrote), and what the user offers them in one line. If the product itself is unclear, ask one
question and stop. Everything else you decide.

## 2. Finding people

In order of preference:
1. **A list the user gave** — a CSV/XLSX/Sheet or names in the message. Read it (read_file, or the
   office-automation skill for .xlsx). Keep their columns.
2. **The web** — web_search for the ICP ("head of engineering" fintech Mumbai site:linkedin.com/in,
   company "careers" pages, conference speaker lists, GitHub org members, Product Hunt makers). Take
   the public profile URL, name, title, company.
3. **LinkedIn in the browser** — browser_navigate to a people search with the ICP's filters, then
   browser_read_page. Only what is on screen; page through with browser_scroll. If the browser is
   not logged in, say so and stop: the user signs in themselves (never ask for their password).

Stop at the number the user asked for, or 25 if they did not say. Deduplicate against the log.

## 3. Research, per person — this is the job

For each person, in under a minute of tools, find one specific, true, recent thing:
- their company's page (web_fetch): what they sell, a recent launch, a hiring post, a customer;
- their profile / a post / a talk / a repo (web_fetch or browser_read_page): what they care about;
- for a tech-stack ICP: a job listing naming the stack, or a GitHub repo.
Write the hook as one line in `why`: *"Hiring 3 backend engineers this month (careers page) — AI
pairing is a cost lever"*. If you cannot find anything specific and true, say so in `why` and use a
plain, honest opener; never invent a detail about a person.

## 4. The message

Under 500 characters for LinkedIn (a connection note is 300), 120 words for email. Structure:
1. the hook — the specific thing you found, in their words, one line;
2. the bridge — why that connects to what the user offers, one line, no adjectives;
3. the ask — one small, concrete next step (a 15-minute call this week / a reply / a look at a
   link), with a way to say no.
Their name once, the user's name in the sign-off, no "I hope this finds you well", no "quick
question", no exclamation marks, no bullet lists, no links in the first LinkedIn message.
Write it in the language the person writes in. Vary sentence shape across the batch — twenty
messages that start the same way are spam and read as spam.

## 5. Review — the gate

`outreach_review` with the campaign, the channel and every draft (name, title, company, url, why,
message). The user ticks, edits and approves. Only the rows that come back are sent, with the
returned message text (they may have edited it). If it comes back cancelled, ask what to change
and stop.

## 6. Sending, one at a time, at a human pace

For each approved row, in order:
- **LinkedIn:** browser_navigate to the profile url; browser_read_page; click "Message" (or
  "Connect" → "Add a note" for a connection request); browser_type the message into the composer;
  browser_screenshot and read it back — the text must match the approved draft exactly; click Send.
  If the page shows a limit, a captcha, a "not connected" wall or anything unexpected: stop, log
  `failed` with the reason, and tell the user. Do not work around it.
- **Email:** only through a mail tool the user connected (an MCP server or the Gmail/Outlook web
  app in the browser, signed in by them). Subject under 6 words, the message as the body.
- After each send: `outreach_log` with status `sent` (or `failed`), then wait 45–90 seconds
  (run_command `Start-Sleep -Seconds 60` on Windows, `sleep 60` elsewhere) before the next one.
  Never parallelise sends.

## 7. Report

One short table: name · company · status · hook used. Then what to do next: replies to watch for
(the user can ask you to check the inbox / LinkedIn messages tomorrow), who was queued past the
cap, and anyone skipped and why. Offer to set this up as a worker if they want it daily.

## Never

- Send without outreach_review, or send a message different from the approved text.
- Scrape beyond what is on screen, use a bought list without saying so, or invent a fact about a
  person to sound personal.
- Log in, enter credentials, or solve a captcha — the user does those.
- Exceed the daily cap, or send outside the person's working hours if you know their timezone.
