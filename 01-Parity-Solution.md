# Parity — Kill the Quote Spreadsheet

**Aerchain · Product Take-Home Submission**
Candidate: Raj Vineeth · 1 September 2026
Prototype: **built and running** — `parity/` in this repo (`npm install && npm run fabricate && npm run ingest && npm run dev`, one Anthropic API key in `.env`). Extraction runs live on claude-opus-5 and is cached per document hash so recorded and live demos agree. Repo: https://github.com/vamsiraju1/rajvineeth

> Every figure in this document is the **actual output of the reference run** (2026-09-01) — extraction, normalization, and analysis really ran on the five fabricated artifacts, and the pipeline independently reproduced the dataset's designed economics. Where the run differed from my design targets, the run's numbers are quoted.

---

## TL;DR

Parity is an AI procurement workspace built around one flow: a buyer **talks an RFx into existence**, sends it to five vendors over plain email, and then does nothing while the system **reads whatever comes back** — a beautiful off-template Excel, a PDF with the discount in a footnote, a Word doc with commercials in prose, an angled phone photo of a rate card, and a one-line email that says "rest same as last year." Every number lands in a single normalized comparison — same lines, same units, same currency, same landed basis — where **every cell can show where it came from**. Then the buyer stops clicking and starts asking questions in plain language, all the way to an award memo that defends itself.

The week the brief describes becomes an afternoon. The VP's four-day question becomes a 40-second answer — with receipts.

---

## 1. The category, and why I picked the hard one

**Corrugated packaging for a mid-size snacks company** ("Svaad Foods": 30 box SKUs, plants at Bhiwandi and Hosur, ~₹4.1 crore annual spend).

I picked corrugated deliberately, because its unit problem is *genuinely* hard, not cosmetically hard. The same box is legitimately priced three ways in the same RFQ — **per piece, per kg, and per 100 pieces** — and converting between them isn't string matching, it's arithmetic over the box's physical construction: blank area × board grammage → weight, with real uncertainty in the inputs. A system that survives corrugated normalization — and is honest about that uncertainty — has earned the right to claim it generalizes to IT hardware or MRO. A system demoed on a category where everyone quotes per-unit in INR has proven nothing.

---

## 2. The flow, end to end

### 2.1 Draft — the RFx co-pilot

The buyer uploads last year's PO history and talks:

> **Buyer:** "New year's box RFQ. Same 30 SKUs as FY26, but the 4 e-comm mailers changed dimensions — new artwork files attached. 3-ply for anything under 2 kg packed, 5-ply masters. This year I need FSC chain-of-custody. Delivery to Bhiwandi and Hosur, FOR destination, 45-day credit."
>
> **Co-pilot:** "Drafted 30 lines from FY26 POs; I've flagged the 4 mailers with new dimensions and recomputed their board area — L27's new size crosses your own 2 kg rule, want it in 5-ply? I've added FSC CoC to the questionnaire alongside your standard items (IS 2771 conformance, NABL-lab BF/ECT test reports, defect PPM commitment, backup capacity). Two things you didn't mention that were in last year's terms: quarterly price reset against the kraft paper index, and 2% rejection tolerance. Keep both?"

The interesting design decision is invisible: **the co-pilot's real output is not a document, it's a schema.** Each line gets a stable ID (L01–L30), a spec (style, ply, internal dimensions, GSM/BF), a unit of measure, a delivery plant, and a volume. That canonical schema is the contract every later stage normalizes *into*. The buyer pays a small structure tax at draft time; that tax is exactly what buys vendors total freedom at reply time. Structure at write-time funds chaos-tolerance at read-time.

The schema itself can be wrong, so it isn't sacred: when a vendor's reply disputes a spec ("that die-cut won't run on our machines at 350mm — did you mean 355?"), that becomes an exception card **against the RFx**, and accepting it versions the schema and re-notifies the other vendors. Uncertainty handling points both ways, not just at vendors.

### 2.2 Send — plain email, no portal

Vendors get a clean PDF and an optional Excel they are welcome to ignore. No login, no portal, no template enforcement. This is a product position, not a shortcut: every incumbent suite fails at the same wall — vendors won't do data entry for the privilege of quoting you, so response rates crater and buyers fall back to email anyway. **Vendor mess isn't a bug we tolerate; it's the demand for our product.** (SMTP is stubbed in the prototype — responses drop into a watched inbox — per the brief's "stub the plumbing" rule.)

### 2.3 Read — the extraction pipeline (the real AI loop)

Every response, whatever its shape, goes through the same five stages:

1. **Classify** — email body vs. attachments; xlsx / pdf / docx / image.
2. **Extract — twice, independently.** Two extraction passes (different prompt framings; for photos, different pre-crops) read each artifact against the RFx schema and emit, per line: `{price, currency, unit_basis, moq, validity, notes, source_anchor}` — plus questionnaire answers, attached certificates, and commercial-terms deltas (payment, freight, discounts, escalation). Anchors are the kind each format can support *exactly*: cell reference for xlsx, page + quoted text snippet for PDF/Word, a deskewed row-band crop for photos, the quoted sentence for email. **Confidence is measured by agreement, never asked of the model** — self-reported LLM confidence is famously miscalibrated; two independent passes disagreeing is a fact.
3. **Normalize** — currency (USD → INR at a **pinned RBI reference rate, disclosed in the header**, never a silent live rate); unit basis (per-100 → per-piece is exact division; per-kg → per-piece runs through a computed box weight from the line's dimensions and board construction, carried as an **estimate with a band**: `0.71 kg est. ±8% → ₹29.82 ±₹2.40`, inputs shown in the trail); scope references ("rest same as last year") resolved against the uploaded PO history **with a spec-delta check** — a price only carries forward if the line's spec is unchanged; changed dimensions block the carry and raise an exception instead; landed cost (freight-extra quotes get a disclosed lane estimate added, plant-wise — comparison never mixes an ex-works price with a FOR one silently).
4. **Verify** — every cell lands in exactly one of three states, and the boundary is mechanical, not vibes:
   - 🟢 **Verified** — both passes agree, deterministic sanity checks pass (category price band, basis-magnitude check, row arithmetic), and any conversion applied was *deterministic and disclosed* (FX at the pinned rate, per-100 division). Converted cells wear a small glyph; the trail shows the math.
   - 🟡 **Inferred** — the value rests on an **assumption that could be wrong**: a computed box weight, a freight estimate, a term carried forward from last year. Amber, with the assumption stated on the cell.
   - ⚪ **Missing / Ask** — not quoted, unreadable, or blocked (a "same as last year" pointing at a changed spec). *Never silently filled.*
5. **Exceptions queue** — ambiguous reads become cards, not landmines: *"L09: the two extraction passes could not agree a value — plausible readings 10.75 / 11.75 / … / 19.75. Here's the deskewed crop of that row. [Confirm] [Ask vendor]."* One click drafts the clarification email. In the reference run **the buyer touches exactly six cards, not nine hundred cells**: one declaration-vs-certificate mismatch, two photo ambiguities, and three blocked carry-forwards. Human attention is spent exactly where the passes disagree, and nowhere else.

Then one closing move that most teams would never think to build: **confirm-back**. Each vendor receives a one-page summary of *our reading of their quote* — normalized prices, computed weights ("we computed L23 at 0.71 kg — confirm your billing weight?"), terms, exclusions — with one button: "This is what we understood. Correct?" Converters know their billing weights cold, so this turns the pipeline's weakest inference into a vendor-confirmed fact. It also catches residual extraction errors at the source, and turns any later "your system misread my PDF" dispute into a documented thirty-second lookup that anchors the eventual PO. *We normalize; they notarize.*

### 2.4 Compare — one grid, honest by default

Thirty lines × five vendors, per-piece, INR, landed, GST-exclusive (GST shown separately — HSN 4819, 5% — it's pass-through across registered domestic vendors and only muddies comparison). Cell colors carry the three states. Clicking any cell opens the **provenance panel**: the actual source snippet — the cropped photo row, the PDF footnote, the email sentence — plus the full normalization trail. Alongside the grid: the questionnaire matrix (pass / fail / missing per vendor) **cross-checked against attached documents** — a vendor who ticks "FSC certified" while the attached certificate expired in June gets flagged, because self-declarations and evidence are different things; attached test reports and certs sit one click away. And a **coverage bar** per vendor (Meghdoot: 27/30 — declined the die-cuts).

Defaults are deliberately conservative: totals compute over the **common comparable basis**, and every total prints its own basis line — *"108 verified + 34 inferred cells; 8 missing lines excluded — coverage 27/30."* "What would Meghdoot's total look like if they quoted the missing 3 lines at their average premium?" exists — but only on request, and the result is amber, not green. Optimism is opt-in and labeled.

### 2.5 Ask — the analyst conversation

The buyer asks in plain language; the system answers with text, tables, and charts — and every number is a receipt, not an assertion. Architecture in §3. The kinds of questions this is built for (and the ones in my recorded demo):

- **Split-award with constraints:** "Cheapest per line, but only vendors who cleared the quality questionnaire" — the VP's four-day question.
- **Consolidation math:** "What premium am I paying to give everything to one vendor?"
- **Provenance interrogation:** "Why is Ganpati's L23 amber?"
- **Coverage risk:** "Which lines have fewer than two usable quotes?"
- **Sensitivity:** "If the rupee goes to 91, does the award flip?"
- **Commit:** "Draft the award memo for the compliant split" → exports the comparison (xlsx) and a memo (PDF) listing the decision, the alternatives considered, and **every assumption**: FX pin, freight estimates, weight bands, inferred cells, excluded vendors and why, and the Q&A log of this exact conversation.

The memo is the point. The buyer's real deliverable was never the spreadsheet — it's a defensible decision. Parity's terminal artifact is an award recommendation that survives an audit, a vendor challenge, and the VP's next question.

---

## 3. How the analyst answers — and why it can be trusted with ₹4 crore

**The LLM never does arithmetic on text.** The extracted, normalized, three-state data lives in a typed store (SQLite in the prototype). The analyst is a tool-using agent: it translates the buyer's question into a **structured constraint object** (filters, cell-state policy, mode) plus queries against that store; the engine computes; the answer is composed *around* the computed results. Three consequences:

1. **Correctness:** sums, splits, and sensitivities are computed by a database, not sampled from a language model. The model cannot invent the arithmetic. It *can* still ask the wrong question of the data — which is why:
2. **Auditability at two levels:** every answer renders its constraint object back in plain language — *"Cheapest per line · excluding Shree Balaji (questionnaire not returned) · inferred cells included · 30/30 lines"* — with row counts, so a buyer audits the English restatement; the generated query ships underneath for the auditor. Per-figure links go back to source cells → source lines of source documents. Receipts make a wrong question catchable in one read, and the Q&A log is appended to the decision record.
3. **Stability:** strict/lenient compliance mode is explicit session state, stamped into the memo — not conversational vibes that drift. A regression suite of ~20 question-phrasings over the frozen dataset checks that improvised wordings of the same question return the same numbers.

Constraint semantics are explicit: when the buyer says "vendors who cleared the questionnaire," the system states its filter — *"Excluding Shree Balaji (questionnaire not returned). Ganpati answered 4 of 6 items; including them — say 'strict mode' to exclude."* The buyer can tighten or loosen; the memo records which mode produced the award.

And when the data can't answer, the system says so. Ask "which vendor is most reliable on delivery?" and it replies (verbatim from the live run): *"There is no delivery-performance data in this dataset… If someone hands you a 'most reliable on delivery' ranking off this run, it was invented"* — then offers the nearest labeled proxy (backup-capacity answers). A system that never says "I don't know" cannot be believed when it says anything else.

This discipline caught its own author. During the build, I asked the live analyst the FX question and it **refused to call the flip**: it had checked stored USD conversions against `raw_value × 88.40/100`, found only 2 of 30 cells reconciled, quantified the gap, and told me to resolve the conversion basis before deciding. It had found a real round-before-convert bug in my normalization code. I fixed the code; the receipts had already done their job — on me.

**Trust, summarized — five mechanisms, not a vibe:**

| Mechanism | What it buys |
|---|---|
| Three-state cells with a mechanical boundary; gaps never silently filled | No confident lies — the failure mode that kills trust permanently |
| Provenance to the source line on every cell (cell ref / page + snippet / row crop / sentence) | Any number challenged → resolved in seconds, not meetings |
| Receipts on every analytical answer (plain-language constraints + row counts + query) | The analyst is an auditor's tool, not an oracle |
| Vendor confirm-back, including computed weights | Extraction errors caught at source; disputes become documented lookups |
| Exceptions queue + honest refusals | The system provably knows what it doesn't know |

Trust here is a UX property, not a model property. Accuracy is necessary; **legibility** is what lets a buyer act.

---

## 4. The ugly edges — explicit policy

| Edge (from the brief) | What the system does | What the buyer sees |
|---|---|---|
| Angled phone photo of a rate card | Deskew, then two independent extraction passes; rows where the passes disagree or fail sanity checks are quarantined | 28/30 rows green; 2 exception cards showing both readings and the cropped row band, one-tap resolve/ask |
| Vendor quoted 27 of 30 lines | Coverage tracked per vendor; totals default to common comparable basis, basis printed under every total | Coverage bar "27/30 · declined die-cuts"; opt-in amber extrapolation on request |
| Quoted in USD | Converted at pinned RBI reference rate, disclosed; deterministic → stays green with a conversion glyph; sensitivity on demand | "USD @ ₹88.40 (pinned <date>)" in header; "what if 91?" answered in one question |
| "Per box" vs "per 100 pieces" | Basis extracted per vendor; per-100 → per-piece is exact division; magnitude sanity check (a ₹4 box quoted at ₹400 → basis challenge) | Normalized per-piece grid; basis shown in provenance; anomalies become exception cards |
| "Rest same as last year" | Resolved line-by-line against PO history **behind a spec-delta check** — changed dimensions block the carry-forward | Unchanged terms carry as amber chips ("45-day credit · from FY26 terms"); the 4 re-dimensioned die-cuts surface as an exception: "last-year price not applicable — dims changed. [Ask Ganpati]" |
| "Freight extra" | Landed-cost normalization with disclosed lane estimate, plant-wise (₹0.62/pc Taloja→Bhiwandi is not ₹4–5/pc Taloja→Hosur); toggle to ex-freight view | "+₹0.62/pc freight est. (Taloja→Bhiwandi)" in the trail; Hosur-delivery lines carry Hosur lane estimates — which is exactly why the Hosur vendor wins them |
| Discount buried in a footnote / cell comment | Commercial-terms extraction covers footnotes, comments, prose; conditional discounts modeled as scenarios, never blended into unit prices | "5% above ₹75L/qtr — footnote 3" as a term chip; applied only in scenarios that actually meet the condition |
| Vendor doesn't return the questionnaire | Questionnaire matrix shows Missing, not Fail; compliance filters exclude by stated rule | "Shree Balaji: not returned — excluded from compliant-award scenarios" with one-tap chase email |
| Questionnaire says yes, attached cert says otherwise | Self-declarations cross-checked against attached documents (validity dates, scope, issuing lab) | "Sunrise: FSC CoC ticked — attached cert expired 30 Jun. Flagged pending renewal; strict mode treats as fail" |

The unifying rule: **when unsure, the system gets specific about its uncertainty** — which cell, which source region, which assumption — and routes it to a human or the vendor. It never averages its way past a doubt.

---

## 5. Judgment log — decisions with no right answer, and why I made them

1. **No vendor portal.** Response rate beats structure. The mess is our moat: whoever reads best wins the category, and forcing templates concedes the premise. (This is also why incumbent suites lose to email.)
2. **Normalize into the buyer's RFx schema, not a universal taxonomy.** Universal product ontologies are a boil-the-ocean trap; the RFx already defines what "comparable" means for this event.
3. **Exactly three cell states, with a mechanical boundary.** Green = agreed reads plus deterministic disclosed conversions; amber = anything resting on an assumption; grey = absent. A fourth "probably" state is a lie with a hedge, and a boundary the buyer can't predict is as bad as no boundary.
4. **Conservative defaults, opt-in optimism.** Default totals use the common basis and print it; extrapolations exist but arrive amber and on request.
5. **The LLM writes queries; the engine does math.** It cannot invent the arithmetic; it can still ask the wrong question, so every answer restates its constraints in plain language with row counts. Errors become catchable, and catchable in one read.
6. **Confidence by agreement, not by asking the model.** Two independent passes plus deterministic sanity checks decide what's green. Self-reported confidence is the industry's politest fiction.
7. **Exceptions queue instead of review-everything.** Reviewing 900 green cells destroys the value proposition; reviewing six flagged ones concentrates human judgment where the passes disagreed.
8. **Confirm-back to vendors.** Costs one email; catches errors at the source, converts the weakest inference (computed weights) into vendor-confirmed fact, and turns future disputes into documented lookups. Nobody audits a quote as well as its author.
9. **Recommend, never auto-award.** The system's job is to make the buyer's decision fast and defensible, not to make it. The memo is the product; the click is the buyer's.
10. **Frontier multimodal models + schema + verification loop, no fine-tuned extractors.** At RFQ volumes, fine-tuning buys marginal accuracy at high ossification cost; the dual-pass loop catches the residual, and every base-model release is a free tailwind.
11. **GST out of the comparison, landed freight in — plant-wise.** GST (HSN 4819, 5%) is pass-through across registered domestic vendors; freight is the oldest hide-the-ball trick in quoting, and a Maharashtra vendor's Bhiwandi price is not their Hosur price. Compare landed, ex-GST, per plant.

---

## 6. What I'd measure

- **Time to comparison:** 9 days → same-day as last response received.
- **Buyer-touched cells** per event: target < 10 of ~150 price cells.
- **Post-verification precision on Verified cells:** of the cells the pipeline labels green, ≥99% survive confirm-back and audit unchanged — measured against a rolling hand-audited gold set (N cells/month checked against source documents), not just vendor rubber-stamps. Raw single-pass extraction won't hit this; the pipeline earns it by demoting disagreement to the exceptions queue. Precision on greens is bought with recall pushed to humans, so the **exception rate** is tracked right beside it.
- **Provenance coverage:** 100% of figures in analytical answers traceable to source — by construction, but monitored.
- **Awards exported with memo:** the adoption metric that matters; if buyers export the memo, Parity has become the system of record for the *decision*, not just the data.

---

## 7. The more interesting problem

The brief asks for it, so here it is: **extraction is a melting moat.** Within a couple of model generations, reading an angled photo into a table is a commodity every competitor will have. Two things stay valuable:

1. **The decision layer.** The award memo with receipts — assumptions, alternatives, exclusions, Q&A log — is the artifact procurement has never had. The spreadsheet was never the real product; the *defensible decision* was. That's also the wedge into the CFO conversation, because it's the first time savings claims arrive pre-audited.
2. **The memory.** Every awarded event leaves behind normalized, provenance-backed line-item history. Next year's RFx drafts itself from it; "rest same as last year" resolves against it — spec-deltas and all; negotiation leverage compounds ("your 5-ply is 7% over your own March price"). The co-pilot and the analyst are the same asset at different points in its lifecycle.

I came in to kill a spreadsheet. The body that matters is the decision memo.

---

## Appendix A — Demo dataset ("a procurement person would nod")

**Buyer:** Svaad Foods Pvt Ltd — snacks D2C; plants Bhiwandi (MH) & Hosur (TN); ~₹4.1 Cr annual corrugated spend. The RFQ is evaluated **plant-wise with lane-specific freight** — Maharashtra vendors carry ~₹4–5/pc estimated freight to Hosur (corrugated trucks air; nobody ships boxes 1,100 km competitively), which is precisely why the Hosur vendor wins Hosur-delivery lines.

**Lines (L01–L30):** L01–L17 3-ply RSC shippers (120–150 GSM kraft liners, 18–22 BF; internal dims 325×240×265 to 450×275×185 mm; per-piece ₹6.60–15.45 across vendors); L18–L27 5-ply master cartons (~400×310×320-class; 0.72–0.80 kg computed; ₹27–38); L28–L30 3-ply die-cut e-comm mailers (**new dimensions this year** — this matters below; ₹5.60–10.61). Total basket 3.02 million pcs/yr — **₹4.09 Cr at last year's prices**. Questionnaire: IS 2771 conformance, NABL-lab BF/ECT test reports, FSC chain-of-custody, defect PPM ≤ 2,000, backup capacity, 45-day credit acceptance (the MSMED ceiling — most corrugators are MSMEs).

**The five vendors, each carrying a distinct pathology from the brief:**

| Vendor | Response shape | Wrinkles |
|---|---|---|
| **Sunrise Packaging**, Bhiwandi | Beautiful Excel, own template, merged headers, extra columns | All 30 lines, per-piece; 2% early-payment discount hidden in a cell comment (conditional — our default terms are 45-day credit, so it prices as a scenario); MOQ changes on 3 lines; attaches FSC CoC cert that **expired 30 June** while ticking "FSC certified" |
| **Meghdoot Corrugators**, Chakan | PDF on letterhead | 27/30 (declines the die-cuts, L28–L30); 5% discount above ₹75L/qtr buried in footnote 3; per-piece; attaches NABL BF/ECT test report |
| **Kwality Kartons**, Hosur (EOU / export-focused unit) | Word doc, commercials in paragraphs | Quotes **USD per 100 pieces** out of export habit; FOR destination; all 30 lines; attaches IS 2771 conformance letter + test report |
| **Shree Balaji Packers**, Vasai | Angled phone photo of a printed rate card | 28 rows where both extraction passes agree, 2 where they don't (L09: smudged digit → candidate readings ₹10.75–₹19.75, crop attached; L22 blotted); questionnaire not returned; cheapest on many 3-ply lines |
| **Ganpati Boards**, Taloja (incumbent) | One-line email: *"₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra."* | Per-kg → weight math per line (estimate bands, confirm-back asks billing weights); "rest" hits the re-dimensioned die-cuts → **spec-delta check blocks the carry-forward** and raises the showcase exception ("last-year price not applicable — dims changed; and does ₹38/kg cover die-cuts? [Ask]"); FY26 commercial terms carry as amber chips; freight-extra → plant-wise landed adjustment |

**Reference-run actuals** (extraction → normalization → SQL over the extracted store; independently matching the fabrication ground truth): last-year baseline **₹4.09 Cr**; naive cheapest-per-line split (all five vendors) **₹3.79 Cr** (−7.3%); **compliant split ₹3.90 Cr** (−4.6%); best single vendor (Sunrise, all 30) **₹4.00 Cr**, ₹3.92 Cr if its 2% early-pay option is exercised. The gaps are the story: **₹10.8L is the price of compliance** (naive → compliant); **₹10.3L is the consolidation premium** (single vendor vs. split). At the ₹88.40 pin, Kwality wins 6 lines — L03, L06, L09, L12, L15, L19, all Hosur deliveries; at ₹91 it keeps 2 (L15, L19), the other 4 flip to Meghdoot, worsening the split by **₹1.7L**. Cell census: **115 verified · 27 inferred · 8 missing · 6 exceptions** (1 expired-certificate mismatch, 2 photo ambiguities, 3 blocked carry-forwards).

## Appendix B — Build log (the prototype exists; this is what was built)

**Stack:** Next.js (App Router) + SQLite (`node:sqlite`); Claude **claude-opus-5** for both AI loops — schema-constrained structured outputs for extraction (vision for the photo, native PDF reading for the letterhead and certificates), and a tool-using agent (read-only SQL tool + strict `submit_answer` tool) for the analyst; exceljs/pdfkit/docx/sharp to fabricate and read the artifacts; watched-folder inbox standing in for SMTP; xlsx export; deterministic confirm-back and clarification-email drafts.

**Reference run:** 10 extraction passes (5 documents × 2 framings) + 3 certificate reads, ~66k input / ~42k output tokens, 143 s wall-clock. Result: 115/27/8 cells, 6 exceptions — and the scenario aggregates computed by SQL over the *extracted* store match the fabrication ground truth, which is the strongest correctness check available: the pipeline recovered the dataset's designed economics from the mess alone.

**Reproducibility & anti-hardcoding, by construction:** extraction is **cached per document sha256** — same file, same reading, so the recorded demo and the live demo agree (delete `data/cache/` for a fresh run). Demo questions enjoy no special path: every question, including any the interviewer improvises, flows through the same agent → constraints → SQL → render loop over the same store. The honest-refusal behavior and the constraint restatements are system-prompt discipline, verified live — including once against its author: the analyst caught a normalization rounding bug by reconciling stored prices against raw values (§3).

**Honest scope triage** (what a take-home buys): the RFx is pre-drafted as data (`data/rfx.json`) — the co-pilot drafting conversation in §2.1 is designed but not built in this prototype; photo provenance is a deskewed row-band crop, not model bounding boxes (which drift on angled images — a confident wrong highlight is worse than none); confirm-back renders the outbound draft rather than round-tripping replies; the award memo is produced by the analyst loop rather than a bespoke template engine. Everything on the trust path — dual-pass extraction, normalization trails, three-state verification, live analyst queries, receipts, refusals — is real.
