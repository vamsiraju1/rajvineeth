# Parity — Kill the Quote Spreadsheet (working prototype)

An AI procurement workspace: a buyer's RFx goes out over email, five vendors reply in
whatever shape they like — a beautiful off-template Excel, a PDF with the discount in
footnote 3, a Word doc quoting **USD per 100 pieces** in prose, an **angled phone photo**
of a printed rate card, and a one-line email ("42/kg for the 5 ply, 38 for the 3 ply,
rest same as last year, freight extra") — and the system reads all of them into one
normalized, provenance-anchored comparison the buyer can interrogate in plain language.

Built for the Aerchain product take-home. **The AI loops are real**: extraction runs
live on claude-opus-5 (dual-pass, agreement-gated), and the analyst writes SQL against
the extracted store for every question — nothing is precomputed per question.

## Run it

```bash
npm install
npm run fabricate   # generates the RFx + the five messy vendor artifacts + certs
npm run ingest      # REAL extraction: 2 passes/doc on claude-opus-5 (cached per file hash)
npm run dev         # http://localhost:3400
```

Put an Anthropic API key in `../.env` as `ANTHROPIC_API_KEY=...` (the app loads it from there).

## Reference run (2026-09-01, claude-opus-5)

- **150 price cells → 115 verified · 27 inferred · 8 missing · 6 exceptions** for a human:
  1 declaration-vs-attachment mismatch (Sunrise ticks "FSC certified"; the attached cert expired 30-Jun-2026),
  2 photo ambiguities (L09's smudged digit → candidate readings listed, crop shown; L22 blotted),
  3 carry-forward blocks (Ganpati's "rest same as last year" hits the 3 die-cut mailers whose dimensions changed since FY26 — the spec-delta check refuses to resolve and drafts the ask).
- Scenario actuals over extracted data: baseline (last year) ₹4.09 Cr · naive cheapest split ₹3.79 Cr (−7.3%) · **compliant split ₹3.90 Cr** (−4.6%) · best single vendor ₹4.00 Cr. Compliance gap ₹10.8L; consolidation premium ₹10.3L. Kwality (USD-quoted) wins 6 lines at ₹88.40 pinned, keeps 2 at ₹91 (+₹1.7L).
- These match the fabrication ground truth independently — the pipeline reproduces the dataset's designed economics from the messy artifacts alone.

## How trust is engineered

- **Confidence by agreement, not self-report**: every document is extracted twice with different
  framings; a cell is Verified only when both passes agree and deterministic sanity checks pass.
  Disagreement → an exception card with both readings and the source crop. The model is never asked
  "how confident are you?"
- **Three states, mechanical boundary**: Verified (agreed + only deterministic disclosed conversions —
  FX pin, per-100 division, shown with a ⇄ glyph), Inferred (assumption-bearing: computed box weight
  ±8%, freight-lane estimate, FY26 term carry — assumption printed on the cell), Missing (never
  silently filled).
- **Provenance to the source line**: xlsx cell refs, PDF page+quote, deskewed row-band crops for the
  photo, the exact email sentence — one click from every cell.
- **The analyst never does arithmetic**: it emits a plain-language constraint restatement, writes
  read-only SQL, and every figure ships with receipts (the queries + row counts). It refuses questions
  the store can't answer (ask it "which vendor is most reliable on delivery?").
- **Receipts work.** During the build, the analyst itself refused to call the FX flip because stored
  USD conversions didn't reconcile with `raw_value × 88.4/100` — it had caught a real
  round-before-convert bug in the normalization code (since fixed). That is the trust architecture
  doing its job on its own author.

## Anti-hardcoding

Demo questions have no special path. Every question — including improvised ones — runs the same
agent → constraints → SQL → render loop over the same store. Extraction outputs are cached by
document sha256 so recorded and live runs agree; delete `data/cache/` to force fresh extraction, or
drop a sixth vendor file into `data/inbox/` and add it to `scripts/ingest.mjs`'s vendor list.

## Honest scope triage

The RFx itself is pre-drafted (`data/rfx.json`) — the co-pilot conversation from the design doc is not
built in this prototype. SMTP is stubbed (a watched folder). Confirm-back renders the outbound email
draft; it doesn't round-trip replies. Photo provenance uses a per-image skew estimate + row bands, not
model bounding boxes (which drift on angled photos). The memo is produced by the analyst loop rather
than a bespoke template engine.

## Stack

Next.js (App Router, JS) · SQLite via `node:sqlite` · `@anthropic-ai/sdk` (claude-opus-5: structured
outputs for extraction, tool-use loop for the analyst) · exceljs / pdfkit / docx / sharp / mammoth for
fabricating and reading the artifacts.
