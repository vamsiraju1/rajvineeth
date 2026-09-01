# Parity — What I decided, and what I left out

**Aerchain Product Take-Home · One-page note · Raj Vineeth · Prototype: built & running (`parity/` at github.com/vamsiraju1/rajvineeth) — all figures below are the live reference run's outputs**

## What I decided

**The RFx co-pilot's real output is a schema, not a document.** Every line gets a stable ID, spec, unit, plant, and volume at draft time. That small structure tax, paid once by the buyer, is what buys vendors total freedom to reply however they like — and makes reading them tractable. Structure at write-time funds chaos-tolerance at read-time.

**No vendor portal, ever.** Vendors reply over plain email in whatever shape they want. Incumbent suites die at this wall: vendors won't do data entry to quote you, response rates crater, buyers fall back to email anyway. The mess isn't a bug we tolerate — it's the demand for the product. Whoever reads best wins.

**Every cell is in one of exactly three states, and the boundary is mechanical.** Verified means two independent extraction passes agreed, sanity checks passed, and any conversion was deterministic and disclosed (the FX pin, per-100 division). Inferred means an assumption is load-bearing — a computed box weight (±8%, band shown), a freight estimate, a term carried from last year — and the assumption sits on the cell. Missing is never silently filled: "rest same as last year" pointing at a box whose dimensions changed gets blocked and asked, not resolved. Confidence is measured by agreement, never asked of the model. The buyer touches a handful of flagged cells — six, in the reference run — not nine hundred.

**The LLM never does arithmetic.** The analyst turns questions into explicit constraints plus queries over the typed store; the database computes. It cannot invent the arithmetic — it can still ask the wrong question, so every answer restates its constraints in plain language with row counts, ships the query underneath, and links every figure to its source line. The Q&A log joins the audit trail. This discipline has already caught its own author: mid-build, the live analyst refused to call an FX flip because stored USD conversions didn't reconcile with the documented formula — a real rounding bug in my normalization code, found by the system's receipts before any human review.

**Vendors notarize the extraction.** Each vendor gets back "here's how we read your quote — including the box weights we computed. Correct?" Confirm-back catches errors at the source, turns the weakest inference into vendor-confirmed fact, and makes any later dispute a documented lookup that anchors the PO. We normalize; they notarize.

**Conservative by default.** Totals compute on the common comparable basis and print it; landed, ex-GST, plant-wise. Extrapolating a 27/30 vendor's missing lines exists — opt-in, and amber. Recommend, never auto-award: the memo is the product; the click is the buyer's.

## What I deliberately left out

Negotiation rounds and reverse auctions; ERP/PO integration; vendor onboarding and master data; approval workflows; contract authoring; mobile. All real, none of them the hard part. I also chose **not** to fine-tune extraction models — at RFQ volumes, frontier multimodal models plus a schema plus dual-pass verification beat an ossified custom model, and every base-model release is a free tailwind.

## Where the interesting problem actually was

Extraction is a melting moat — in two model generations, reading an angled photo is a commodity. What compounds is the **decision layer and its memory**: the award memo with receipts (the artifact procurement never had — the spreadsheet was never the product, the defensible decision was), and the normalized price history that drafts next year's RFx and arms next year's negotiation. I came in to kill a spreadsheet; the body that matters is the decision memo.
