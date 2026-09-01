# Parity — Recorded Walkthrough Script

**The analyst conversation · target runtime 9–10 minutes · ~1,200 spoken words at a calm 140 wpm, plus typing and render time**

> **Before you record:**
> - Every **bolded figure** below is the *actual output of the reference run* (2026-09-01) on the built prototype in `parity/` — not a target. Before recording, run `npm run ingest` and the seven questions once yourself; if any number shifts (fresh extraction after clearing the cache can move paise), say so on camera — "the earlier run said 3.90, this run says 3.91" *builds* credibility. Never speak a number the screen isn't showing.
> - Extraction is cached per document hash, so your recorded run and a later live demo will agree.
> - **Narrate over the renders.** Hit Enter, then keep talking while the agent writes its queries (10–60s on opus — the "writing queries against the quote store…" spinner is proof of life, not dead air). If an answer runs long, say so ("it's checking its own conversions — you'll see why that matters").
> - Type the questions live while speaking them — the unscripted feel is the point. Face-to-camera for open and close only.

---

### COLD OPEN — face to camera · 0:00–0:35

Here's a week I want to delete. Thirty lines of packaging go out to five vendors — and what comes back is an Excel that ignores the template, a PDF with the discount in footnote three, a Word doc quoting dollars per hundred pieces in a paragraph, an angled phone photo of a rate card, and one email that just says "42 a kilo for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra."

Three days of retyping. Then the VP asks one question — there goes day four.

I built Parity to end that. Let me skip the happy path and show you what happens when the buyer stops clicking and starts asking.

---

### SETUP — one minute of orientation · 0:35–1:50

**[SCREEN: the comparison grid — 30 lines × 5 vendors, colored cells, coverage bars]**

Thirty seconds on this screen, because everything else rests on whether you trust it.

The RFx went out over plain email. No portal, no template — vendors replied however they liked, and the system read every response **twice, independently**, into this one grid. Same lines, same units, same currency, landed cost, ex-GST.

Three colors. Green — the two readings agreed and the cell is anchored to its source; the little arrows mean a deterministic conversion, like dollars at the pinned rate. Amber — there's an assumption underneath, and the cell will show it to you. Grey — missing. **The system never fills a gap silently.**

**[SCREEN: click Ganpati's L20 — provenance panel opens: the email sentence, the math beneath. Close it.]**

That one-line email? Click any Ganpati cell — there's the actual sentence it came from, with the conversion math underneath. Every number here can explain itself.

**[SCREEN: Exceptions tab — six cards]**

And where it wasn't sure, it didn't guess — it asked. This run left the buyer **six** cards. Two smudged rows on the photo — here's the crop, tap to confirm or ask the vendor. Three lines where the incumbent said "same as last year" — and one vendor whose paperwork doesn't match their claims. We'll meet all of those. Six cards — not nine hundred cells.

Now — the conversation.

---

### Q1 — THE VP'S QUESTION · 1:50–3:25

**[SCREEN: type:]** *"Award each line to the cheapest vendor — include the non-compliant ones, I want the floor."*

**[SCREEN: narrate over the render]**

The floor is **₹3.79 crore** against last year's **₹4.09** — about **seven percent** saved. Looks great. It's also not an award anyone should sign, and here's the question that used to cost the buyer their fourth day:

**[SCREEN: type:]** *"Now redo it with only vendors who cleared the quality questionnaire."*

Watch what it does before it answers. **[SCREEN: highlight the constraint restatement]** It states its rule in plain language: Shree Balaji is out — cheapest on paper, but the questionnaire never came back. Ganpati is in on last year's file, and I can say "strict mode" to flip that. And it's flagged that Sunrise ticked "FSC certified" while their attached certificate **expired in June** — caught by reading the actual certificate, not the checkbox.

The compliant split is **₹3.90 crore**. So that **₹10.8 lakh** gap between the floor and this number — that's the price of compliance. It used to be a feeling. Now it's a number, and the buyer can look the VP in the eye either way.

### Q2 — THE CONSOLIDATION PREMIUM · 3:25–4:10

**[SCREEN: type:]** *"What if I give everything to one vendor instead? What's the premium?"*

Best single vendor is Sunrise at **₹4.00 crore** — or **₹3.92** if we take the two-percent early-payment option it found hiding in a cell comment. Notice it didn't blend that in: our terms are 45-day credit, so the discount is priced as a scenario with its condition attached. Same for Meghdoot's footnote-three discount — five percent above seventy-five lakh a quarter — which only fires if you consolidate on *them*.

So one throat to choke costs about **₹10 lakh** a year over the split. Not a recommendation — a priced trade-off.

### Q3 — INTERROGATING A NUMBER · 4:10–5:10

Now the trust question. Four crore on the line, and one number looks high.

**[SCREEN: type:]** *"Why is Ganpati's L23 amber?"*

**[SCREEN: provenance panel — email sentence, weight estimate with band, freight line]**

Two assumptions, and it shows me both. Ganpati quoted rupees per kilo — so this price came through a computed box weight: **0.774 kilos, plus or minus eight percent**, which puts the box at **₹32.51**. And then **₹5.26** of estimated freight — because the email said "freight extra," and this line delivers to Hosur, eleven hundred kilometres from their plant. That freight line is exactly why the incumbent loses the south.

[beat]

And the confirm-back draft already asks Ganpati to confirm the billing weight — converters know their weights cold. The moment they reply, this cell's biggest assumption becomes their number, not ours.

Amber isn't a warning — it's an invitation. The system doesn't ask to be trusted; it shows its work.

### Q4 — WHERE AM I EXPOSED? · 5:10–6:00

**[SCREEN: type:]** *"Which lines have the thinnest quote coverage under the compliant filter?"*

The die-cut mailers — L28 to L30. Meghdoot declined them. Shree Balaji's excluded. And here's the subtle one: Ganpati's "rest same as last year" *should* cover them — but these three boxes changed dimensions this year, and the system caught that last year's price belongs to a different box. It refused to carry the number forward and drafted the question instead: does your ₹38-a-kilo rate cover the new die-cuts?

So three lines are running on **two firm quotes** out of four eligible vendors. That's negotiation exposure a spreadsheet never shows you — and the requote request is one click.

### Q5 — STRESS TEST · 6:00–6:55

Kwality quotes in dollars — pinned at **₹88.40**, it says so in the header.

**[SCREEN: type:]** *"If the rupee goes to 91, does the award change?"*

While it works — a confession. The first time I asked this, the system **refused to call it**: it reconciled every stored price against the raw dollar values, found they didn't match, and told me to fix the conversion before deciding. It had caught a rounding bug in my own code. That refusal is why I believe this screen.

**[SCREEN: answer renders]**

Now the books reconcile: at 88.40 Kwality wins **six** lines — all Hosur deliveries, where Maharashtra vendors eat the freight. At **91** it keeps **two**; four flip to Meghdoot, and the split worsens by about **₹1.7 lakh**. Currency risk on this award now has a shape you can hedge, cap, or split away.

### Q6 — THE HONEST REFUSAL · 6:55–7:35

One more, and this one's deliberate.

**[SCREEN: type:]** *"Which vendor is most reliable on delivery?"*

[beat]

Its actual words: **"There is no delivery-performance data in this dataset… if someone hands you a ranking off this run, it was invented."** Then it offers the nearest thing it *does* hold — backup-capacity declarations — clearly labeled as a proxy, not an answer.

A system that never says "I don't know" can't be believed when it says anything else. This refusal is what makes the last five answers worth acting on.

### Q7 — COMMIT · 7:35–8:35

**[SCREEN: type:]** *"Draft the award memo for the compliant split."*

**[SCREEN: scroll the memo — decision, alternatives, assumptions, Q&A log; the xlsx export beside it]**

Everything's on the record: the award, the alternatives it beat and by how much, the FX pin, the freight estimates, every amber cell with its assumption, who was excluded and under which rule — and the log of this exact conversation.

**[SCREEN: flash the confirm-back drafts — one per vendor]**

And the confirm-backs are drafted for all five vendors — our reading of each quote, computed weights included, going back to its author for sign-off before the PO. When a vendor calls to argue later, they'll be arguing with their own confirmation.

This is the real product. The spreadsheet was never the deliverable — **a decision that can defend itself is the deliverable.** Ready for the VP, the auditor, and the vendor on the phone.

---

### CLOSE — face to camera · 8:35–9:20

So — the week the brief asked me to delete: gone. Five ugly documents to one trusted comparison, same day. The four-day VP question, under a minute, with receipts.

Three choices made that work. Vendors got total freedom because the buyer paid a small structure tax up front — the RFx isn't a document, it's a schema. The model never does the math — it writes the query, the database computes, so it can't make a number up; it even caught my bug. And the system is honest about doubt — three states, six cards, one refusal — because with four crore on the line, trust doesn't come from the model. It comes from what the screen is willing to show you.

One more thing: the extraction moat melts — in two model generations, reading that photo is a commodity. What compounds is the decision memo and the price memory underneath it. I came to kill a spreadsheet. Turns out the body that matters is the decision memo.

Thanks — happy to drive it live. Bring your own questions.

---

> **Recording checklist:** `npm run ingest` (cached, seconds) · dry-run all seven questions once for latency and to confirm the figures on screen · leave the L09 photo card and one Ganpati carry-forward card open on camera; the FSC card stars in Q1 · practice the two provenance clicks (**L20** in setup, **L23** in Q3) · FX pin shows 88.40 in the header · keep the exceptions tab one click away · exports pre-warmed · if the interviewer will drive later, offer them the improvised-question test — it's the best proof nothing is canned · one full timed dry run.
