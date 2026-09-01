// Runs the full read pipeline on everything in data/inbox/: dual-pass extraction
// (real model calls, cached per document hash), deterministic normalization and
// verification, attachment cross-checks, and writes the quote store (parity.db).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { openDb, initSchema, setMeta, DB_PATH } from "../lib/db.mjs";
import { extractVendor, extractCert } from "../lib/extract.mjs";
import { normalizeVendor, attachmentFlags } from "../lib/normalize.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", "..", ".env") });
const DATA = path.join(here, "..", "data");
const INBOX = path.join(DATA, "inbox");
const TODAY = new Date().toISOString().slice(0, 10);

const rfx = JSON.parse(fs.readFileSync(path.join(DATA, "rfx.json"), "utf8"));
const vendorFileAll = JSON.parse(fs.readFileSync(path.join(DATA, "vendor-file.json"), "utf8"));

// PO history → map by line id
const poHistory = {};
const [hdr, ...rows] = fs.readFileSync(path.join(DATA, "po-history.csv"), "utf8").trim().split("\n").map((r) => r.split(","));
const col = Object.fromEntries(hdr.map((h, i) => [h, i]));
for (const r of rows) {
  poHistory[r[col.line_id]] = {
    dims: r[col.dims_mm], po_number: r[col.po_number], po_date: r[col.po_date],
    unit_price: parseFloat(r[col.unit_price_inr]), vendor: r[col.vendor],
  };
}

const VENDORS = [
  { name: "Sunrise Packaging", city: "Bhiwandi", file: "sunrise-quote.xlsx", kind: "Excel (own template)" },
  { name: "Meghdoot Corrugators", city: "Chakan", file: "meghdoot-quote.pdf", kind: "PDF on letterhead" },
  { name: "Kwality Kartons", city: "Hosur", file: "kwality-quote.docx", kind: "Word doc, USD per 100" },
  { name: "Shree Balaji Packers", city: "Vasai", file: "shreebalaji-ratecard.jpg", kind: "Phone photo of rate card" },
  { name: "Ganpati Boards", city: "Taloja", file: "ganpati-email.txt", kind: "One-line email" },
];

// concurrency-limited runner (be gentle on fresh API keys' rate limits)
async function pooled(tasks, limit = 3) {
  const results = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) { const idx = i++; results[idx] = await tasks[idx](); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

console.log(`Parity ingest — model: ${process.env.PARITY_MODEL || "claude-opus-5"}, ${VENDORS.length} vendors x 2 passes + certs\n`);
const t0 = Date.now();

// ---- extraction (the real AI loop) ----
const tasks = [];
for (const v of VENDORS) {
  for (const pass of ["A", "B"]) {
    tasks.push(async () => {
      const out = await extractVendor({ filePath: path.join(INBOX, v.file), rfx, pass });
      console.log(`  extracted ${v.name} pass ${pass}: ${out.line_quotes?.length ?? 0} line quotes, ${out.terms?.length ?? 0} terms, ${out.questionnaire?.length ?? 0} questionnaire items${out._usage ? ` (${out._usage.input}in/${out._usage.output}out tok)` : " (cache)"}`);
      return { vendor: v.name, pass, out };
    });
  }
}
const certFiles = fs.readdirSync(path.join(INBOX, "attachments")).filter((f) => f.endsWith(".pdf"));
for (const f of certFiles) {
  tasks.push(async () => {
    const out = await extractCert(path.join(INBOX, "attachments", f));
    console.log(`  extracted attachment ${f}: ${out.kind}${out.valid_until ? `, valid until ${out.valid_until}` : ""}`);
    return { cert: f, out };
  });
}
const results = await pooled(tasks, 3);

const passResults = {};
const certByFile = {};
for (const r of results) {
  if (r.cert) certByFile[r.cert] = r.out;
  else (passResults[r.vendor] ??= {})[r.pass] = r.out;
}

// ---- normalization + verification (deterministic) ----
fs.rmSync(DB_PATH, { force: true });
fs.rmSync(DB_PATH + "-wal", { force: true });
fs.rmSync(DB_PATH + "-shm", { force: true });
const db = openDb(false);
initSchema(db);

const insLine = db.prepare("INSERT INTO lines VALUES (?,?,?,?,?,?,?,?,?,?)");
for (const l of rfx.lines)
  insLine.run(l.id, l.description, l.style, l.ply, l.dims_mm.join("x"), l.plant, l.qty_month, l.qty_month * 12, l.weight_kg, 8);

const insCell = db.prepare("INSERT INTO cells VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const insExc = db.prepare("INSERT INTO exceptions (vendor,line_id,kind,title,detail,status) VALUES (?,?,?,?,?,'open')");
const insTerm = db.prepare("INSERT INTO terms VALUES (?,?,?,?,?,?)");
const insQ = db.prepare("INSERT INTO questionnaire VALUES (?,?,?,?,?,?)");
const insAtt = db.prepare("INSERT INTO attachments VALUES (?,?,?,?,?,?)");
const insVendor = db.prepare("INSERT INTO vendors VALUES (?,?,?,?,?,?,?,?,?,?)");

let stats = { verified: 0, inferred: 0, missing: 0, exceptions: 0, flags: 0 };
for (const v of VENDORS) {
  const { A, B } = passResults[v.name];
  const norm = normalizeVendor({
    vendorMeta: v, passA: A, passB: B, rfx, poHistory,
    vendorFile: vendorFileAll[v.name], today: TODAY,
  });
  for (const c of norm.cells) {
    insCell.run(c.line_id, c.vendor, c.price, c.state, c.converted, c.raw_value, c.raw_unit, c.raw_currency,
      c.freight_per_pc, JSON.stringify(c.assumptions), JSON.stringify({ ref: c.anchor }), JSON.stringify(c.trail), c.pass_a, c.pass_b);
    stats[c.state]++;
  }
  for (const e of norm.exceptions) { insExc.run(e.vendor, e.line_id, e.kind, e.title, JSON.stringify(e.detail)); stats.exceptions++; }
  for (const t of norm.terms) insTerm.run(t.vendor, t.key, t.text, t.conditional ? 1 : 0, t.condition, t.anchor);
  for (const q of norm.questionnaire) insQ.run(q.vendor, q.item, q.label, q.answer, q.status, q.note);

  const refs = [...new Set([...(A.attachments_referenced || []), ...(B.attachments_referenced || [])])];
  const flags = attachmentFlags({ vendorName: v.name, questionnaire: norm.questionnaire, certByFile, attachmentsReferenced: refs, today: TODAY });
  for (const ref of refs) {
    const base = ref.split("/").pop();
    const cert = certByFile[base];
    if (cert) {
      const flag = flags.find((f) => f.file === base)?.note || "";
      insAtt.run(v.name, base, cert.kind, cert.summary, cert.valid_until, flag);
    }
  }
  for (const f of flags) {
    insExc.run(f.vendor, null, "attachment_mismatch", `${f.vendor}: ${f.note}`, JSON.stringify(f));
    stats.exceptions++; stats.flags++;
    db.prepare("UPDATE questionnaire SET status='flagged', note=? WHERE vendor=? AND item=?").run(f.note, f.vendor, f.item);
  }

  insVendor.run(v.name, v.city, v.file, v.kind, norm.coverage, norm.questionnaireReturned,
    norm.compliantDefault, norm.compliantStrict, norm.complianceNote, "draft rendered — awaiting vendor confirmation");
  console.log(`  ${v.name}: coverage ${norm.coverage}/30, compliant(default)=${norm.compliantDefault}, strict=${norm.compliantStrict} — ${norm.complianceNote}`);
}

setMeta(db, "fx_pin", rfx.fx_pin);
setMeta(db, "freight_lanes", rfx.freight_lanes_inr_per_kg);
setMeta(db, "event", { event: rfx.event, buyer: rfx.buyer, category: rfx.category, today: TODAY });
setMeta(db, "run_stats", { ...stats, ran_at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) });
setMeta(db, "strict_mode", "0");

console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s.`);
console.log(`Cells: ${stats.verified} verified, ${stats.inferred} inferred, ${stats.missing} missing. Exceptions open: ${stats.exceptions}.`);
console.log(`Quote store: ${DB_PATH}`);
