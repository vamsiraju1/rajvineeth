# Parity — Aerchain Product Take-Home · Raj Vineeth

**"Kill the Quote Spreadsheet"** — a working prototype that drafts an RFx, reads whatever five vendors send back (Excel, PDF, Word, an angled phone photo, a one-line email), lands everything in one normalized comparison, and lets a buyer interrogate it in plain language — all the way to an award memo.

**The AI loops are real.** Extraction runs live on Claude (claude-opus-5), twice per document; the analyst writes SQL against the extracted store for every question. Nothing is precomputed per question, nothing is hardcoded.

---

## What's in this repo

| Path | What it is |
|---|---|
| `parity/` | **The working prototype** (Next.js web app) |
| `parity/data/inbox/` | The five fabricated vendor responses — open them, they're really messy |
| `01-Parity-Solution.md` | The full solution document (product thinking, architecture, judgment log) |
| `02-One-Page-Note.md` | The one-page "what I decided and what I left out" deliverable |
| `03-Video-Script.md` | The word-for-word script for the recorded walkthrough |

---

## Run it (5 minutes)

You need: **Node.js 22.5 or newer** (built-in SQLite is used) and an **Anthropic API key** (console.anthropic.com → API Keys; a few dollars of credit is plenty).

**Step 1 — clone and install:**

```bash
git clone https://github.com/vamsiraju1/rajvineeth.git
cd rajvineeth/parity
npm install
```

**Step 2 — add your API key.** Create a file named `.env` in the **repo root** (the `rajvineeth` folder, one level above `parity/`) containing exactly one line:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**Step 3 — generate the dataset** (the RFx, PO history, and the five messy vendor files):

```bash
npm run fabricate
```

**Step 4 — run the real extraction.** This calls Claude live: 5 documents × 2 independent passes + 3 certificate reads (~2–3 minutes, ~$1.50 of API credit). Results are cached by file hash, so re-running is instant and free:

```bash
npm run ingest
```

You should see it end with something like: `Cells: 115 verified, 27 inferred, 8 missing. Exceptions open: 6.`

**Step 5 — start the app:**

```bash
npm run dev
```

Open **http://localhost:3400** in your browser.

---

## How to use the app

The screen has four areas:

1. **Vendor cards (top)** — each of the 5 vendors: what format they replied in, how many of the 30 lines they quoted, whether they returned the quality questionnaire, and whether they're in the compliant set. Each card has a **confirm-back draft** button — the email that sends our reading of their quote back to them for sign-off.
2. **The comparison grid** — 30 box types × 5 vendors, all normalized to ₹/piece, landed, ex-GST, USD pinned at ₹88.40. Colors: **green** = both extraction passes agreed (⇄ marks a deterministic conversion like USD→INR); **amber** = an assumption is involved (computed box weight, freight estimate); **grey** = missing — never silently filled. **Click any price** to open its provenance: the exact Excel cell / PDF quote / email sentence / photo crop it came from, plus the full conversion math.
3. **Exceptions tab** — the six things the AI refused to guess at: two smudged photo prices (with image crops and Confirm/Ask buttons), three "same as last year" lines blocked because the box dimensions changed, and one vendor whose attached FSC certificate is expired.
4. **Analyst panel (right side)** — ask anything in plain English, or click the suggestion chips. Each answer takes 20–60 seconds (it's writing real database queries; each costs a few cents) and shows: its filter rules in plain language, the answer, figures, tables/charts, and a **receipts** dropdown with the actual SQL it ran.

**The seven demo questions**, in order (these are the suggestion chips):

1. "Award each line to the cheapest vendor — include the non-compliant ones, I want the floor." → **₹3.79 Cr**
2. "Now redo it with only vendors who cleared the quality questionnaire." → **₹3.90 Cr** (the ₹10.8L gap is the price of compliance)
3. "What if I give everything to one vendor instead? What's the premium?" → **₹4.00 Cr**, ~₹10L premium
4. "Why is Ganpati's L23 amber?" → the per-kg → per-piece weight math + freight estimate, from the one-line email
5. "Which lines have the thinnest quote coverage under the compliant filter?" → the die-cut mailers
6. "If the rupee goes to 91, does the award change?" → Kwality keeps 2 of its 6 lines
7. "Which vendor is most reliable on delivery?" → **it refuses** — that data doesn't exist, and it says so
8. Finish with: "Draft the award memo for the compliant split."

**Improvise freely** — ask your own questions in your own words. Everything runs through the same live loop; that's the point.

---

## Recording the video

Open the app, start a screen recording (QuickTime on Mac: File → New Screen Recording, with microphone on), and read `03-Video-Script.md` aloud while clicking what its `[SCREEN: …]` cues say. ~9 minutes. Do one practice run first — the script's checklist at the bottom tells you exactly what to stage.

## Troubleshooting

- **"Could not resolve authentication method"** → the `.env` file is missing, in the wrong folder (it goes in the repo root, not in `parity/`), or the key is pasted wrong.
- **429 / rate-limit errors during ingest** → a brand-new API key has low limits; just run `npm run ingest` again — completed extractions are cached and it resumes where it left off.
- **Want a fresh extraction run** (not cached)? Delete `parity/data/cache/` and re-run ingest.
- **Port 3400 busy** → `npm run dev -- -p 3500` and open localhost:3500.

## Honest scope notes

SMTP is stubbed (responses live in a watched folder, per the brief's "fake the SMTP" liberty). The RFx co-pilot conversation is designed in the solution doc but the RFx ships pre-drafted as data in this prototype. Confirm-back renders the outbound draft; it doesn't round-trip replies. Everything on the trust path — dual-pass extraction, normalization trails, three-state verification, live analyst queries, receipts, refusals — is real. Details in `parity/README.md`.
