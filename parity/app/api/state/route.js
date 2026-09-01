import { NextResponse } from "next/server";
import { openDb, getMeta } from "../../../lib/db.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  let db;
  try {
    db = openDb(true);
  } catch {
    return NextResponse.json({ ready: false, error: "Quote store not found. Run: npm run fabricate && npm run ingest" }, { status: 200 });
  }
  try {
    const lines = db.prepare("SELECT * FROM lines ORDER BY id").all();
    const vendors = db.prepare("SELECT * FROM vendors").all();
    const cells = db.prepare("SELECT * FROM cells").all();
    const exceptions = db.prepare("SELECT * FROM exceptions ORDER BY status = 'open' DESC, id").all();
    const questionnaire = db.prepare("SELECT * FROM questionnaire").all();
    const terms = db.prepare("SELECT * FROM terms").all();
    const attachments = db.prepare("SELECT * FROM attachments").all();
    const qaCount = db.prepare("SELECT COUNT(*) n FROM qa_log").get().n;
    const meta = {
      fx_pin: JSON.parse(getMeta(db, "fx_pin") || "{}"),
      run_stats: JSON.parse(getMeta(db, "run_stats") || "{}"),
      event: JSON.parse(getMeta(db, "event") || "{}"),
    };
    return NextResponse.json({ ready: true, lines, vendors, cells, exceptions, questionnaire, terms, attachments, meta, qaCount });
  } finally {
    db.close();
  }
}
