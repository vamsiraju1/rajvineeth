import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { openDb, setMeta } from "../../../lib/db.mjs";
import { extractVendor } from "../../../lib/extract.mjs";
import { normalizeVendor } from "../../../lib/normalize.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED = new Set([".pdf", ".xlsx", ".docx", ".jpg", ".jpeg", ".png", ".txt", ".eml"]);
const KIND = { ".pdf": "PDF (uploaded)", ".xlsx": "Excel (uploaded)", ".docx": "Word doc (uploaded)", ".jpg": "Photo (uploaded)", ".jpeg": "Photo (uploaded)", ".png": "Photo (uploaded)", ".txt": "Email/text (uploaded)", ".eml": "Email (uploaded)" };

// Live ingestion of a new vendor response: same dual-pass extraction, same
// normalization, same store — the uploaded file gets no special treatment.
export async function POST(req) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "no file" }, { status: 400 });
  const ext = path.extname(file.name || "").toLowerCase();
  if (!ALLOWED.has(ext)) return NextResponse.json({ error: `unsupported type ${ext} — send pdf, xlsx, docx, jpg/png, or txt` }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "file too large (20MB max)" }, { status: 400 });

  const dataDir = path.join(process.cwd(), "data");
  const upDir = path.join(dataDir, "inbox", "uploads");
  fs.mkdirSync(upDir, { recursive: true });
  const safeName = `${Date.now()}-${path.basename(file.name).replace(/[^\w.\-]/g, "_")}`;
  const filePath = path.join(upDir, safeName);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));

  const rfx = JSON.parse(fs.readFileSync(path.join(dataDir, "rfx.json"), "utf8"));
  const poHistory = {};
  const [hdr, ...rows] = fs.readFileSync(path.join(dataDir, "po-history.csv"), "utf8").trim().split("\n").map((r) => r.split(","));
  const col = Object.fromEntries(hdr.map((h, i) => [h, i]));
  for (const r of rows) poHistory[r[col.line_id]] = { dims: r[col.dims_mm], po_number: r[col.po_number], po_date: r[col.po_date], unit_price: parseFloat(r[col.unit_price_inr]), vendor: r[col.vendor] };

  try {
    // The real AI loop — two independent passes, exactly like the reference vendors.
    const [A, B] = await Promise.all([
      extractVendor({ filePath, rfx, pass: "A" }),
      extractVendor({ filePath, rfx, pass: "B" }),
    ]);
    const vendorName = (A.vendor_name || B.vendor_name || path.basename(file.name, ext)).trim().slice(0, 60) || "Uploaded vendor";
    const vendorMeta = { name: vendorName, city: (form.get("city") || "").toString().trim(), file: `uploads/${safeName}`, kind: KIND[ext] };
    const norm = normalizeVendor({ vendorMeta, passA: A, passB: B, rfx, poHistory, vendorFile: undefined, today: new Date().toISOString().slice(0, 10) });

    const db = openDb(false);
    try {
      // re-uploading the same vendor replaces its previous rows
      for (const t of ["cells", "terms", "questionnaire"]) db.prepare(`DELETE FROM ${t} WHERE vendor=?`).run(vendorName);
      db.prepare("DELETE FROM exceptions WHERE vendor=?").run(vendorName);
      db.prepare("DELETE FROM vendors WHERE name=?").run(vendorName);

      const insCell = db.prepare("INSERT INTO cells VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      for (const c of norm.cells)
        insCell.run(c.line_id, c.vendor, c.price, c.state, c.converted, c.raw_value, c.raw_unit, c.raw_currency,
          c.freight_per_pc, JSON.stringify(c.assumptions), JSON.stringify({ ref: c.anchor }), JSON.stringify(c.trail), c.pass_a, c.pass_b);
      const insExc = db.prepare("INSERT INTO exceptions (vendor,line_id,kind,title,detail,status) VALUES (?,?,?,?,?,'open')");
      for (const e of norm.exceptions) insExc.run(e.vendor, e.line_id, e.kind, e.title, JSON.stringify(e.detail));
      const insTerm = db.prepare("INSERT INTO terms VALUES (?,?,?,?,?,?)");
      for (const t of norm.terms) insTerm.run(t.vendor, t.key, t.text, t.conditional ? 1 : 0, t.condition, t.anchor);
      const insQ = db.prepare("INSERT INTO questionnaire VALUES (?,?,?,?,?,?)");
      for (const q of norm.questionnaire) insQ.run(q.vendor, q.item, q.label, q.answer, q.status, q.note);
      db.prepare("INSERT INTO vendors VALUES (?,?,?,?,?,?,?,?,?,?)").run(
        vendorName, vendorMeta.city, vendorMeta.file, vendorMeta.kind, norm.coverage, norm.questionnaireReturned,
        norm.compliantDefault, norm.compliantStrict, norm.complianceNote, "draft rendered — awaiting vendor confirmation");

      // refresh run stats from the store
      const s = db.prepare("SELECT state, COUNT(*) n FROM cells GROUP BY state").all();
      const stats = Object.fromEntries(s.map((r) => [r.state, r.n]));
      const exc = db.prepare("SELECT COUNT(*) n FROM exceptions WHERE status='open'").get().n;
      setMeta(db, "run_stats", {
        verified: stats.verified || 0, inferred: stats.inferred || 0, missing: stats.missing || 0,
        exceptions: exc, ran_at: new Date().toISOString(), note: "includes live-uploaded vendor(s)",
      });
    } finally { db.close(); }

    return NextResponse.json({
      ok: true, vendor: vendorName, coverage: norm.coverage,
      exceptions: norm.exceptions.length, compliance: norm.complianceNote,
    });
  } catch (e) {
    console.error("upload ingest error", e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
