import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { openDb, getMeta } from "../../../lib/db.mjs";

export const dynamic = "force-dynamic";

// Exports the normalized comparison as xlsx — states, assumptions and coverage included.
export async function GET() {
  const db = openDb(true);
  const lines = db.prepare("SELECT * FROM lines ORDER BY id").all();
  const vendors = db.prepare("SELECT name FROM vendors").all().map((v) => v.name);
  const cells = db.prepare("SELECT * FROM cells").all();
  const exceptions = db.prepare("SELECT * FROM exceptions").all();
  const terms = db.prepare("SELECT * FROM terms").all();
  const fx = JSON.parse(getMeta(db, "fx_pin") || "{}");
  db.close();

  const cellMap = {};
  for (const c of cells) cellMap[`${c.line_id}|${c.vendor}`] = c;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Comparison");
  ws.addRow([`Parity normalized comparison — INR/pc, landed, ex-GST. USD pinned @ ${fx.rate_inr} (${fx.source || ""})`]);
  ws.addRow(["Cell states: V = verified, I = inferred (assumption shown in store), blank = missing/blocked"]);
  ws.addRow([]);
  const hdr = ["Line", "Description", "Plant", "Qty/mo"];
  for (const v of vendors) hdr.push(`${v} (Rs/pc)`, "state");
  ws.addRow(hdr).font = { bold: true };
  for (const l of lines) {
    const row = [l.id, l.description, l.plant, l.qty_month];
    for (const v of vendors) {
      const c = cellMap[`${l.id}|${v}`];
      row.push(c?.price ?? "", c?.price != null ? (c.state === "verified" ? "V" : "I") : "");
    }
    ws.addRow(row);
  }
  const we = wb.addWorksheet("Exceptions");
  we.addRow(["#", "Vendor", "Line", "Kind", "Title", "Status", "Resolution"]).font = { bold: true };
  for (const e of exceptions) we.addRow([e.id, e.vendor, e.line_id || "", e.kind, e.title, e.status, e.resolution || ""]);
  const wt = wb.addWorksheet("Terms");
  wt.addRow(["Vendor", "Key", "Text", "Conditional", "Condition", "Source"]).font = { bold: true };
  for (const t of terms) wt.addRow([t.vendor, t.key, t.text, t.conditional ? "yes" : "", t.condition_text || "", t.anchor || ""]);

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="parity-comparison.xlsx"',
    },
  });
}
