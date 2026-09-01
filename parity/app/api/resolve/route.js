import { NextResponse } from "next/server";
import { openDb } from "../../../lib/db.mjs";

export const dynamic = "force-dynamic";

// Human-in-the-loop resolution of an exception card.
// action=confirm: buyer confirmed a reading -> cell becomes verified (human-confirmed).
// action=ask: marks the card as sent-for-clarification (the drafted email is composed client-side).
export async function POST(req) {
  const { id, action, value } = await req.json();
  const db = openDb(false);
  try {
    const exc = db.prepare("SELECT * FROM exceptions WHERE id=?").get(id);
    if (!exc) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (action === "confirm" && typeof value === "number") {
      const cell = db.prepare("SELECT * FROM cells WHERE line_id=? AND vendor=?").get(exc.line_id, exc.vendor);
      const trail = cell ? JSON.parse(cell.trail || "[]") : [];
      trail.push(`Buyer confirmed reading Rs ${value} from the source (exception #${id} resolved by human review)`);
      const freight = cell?.freight_per_pc || 0;
      db.prepare("UPDATE cells SET price=?, state='verified', raw_value=?, trail=? WHERE line_id=? AND vendor=?")
        .run(value + freight, value, JSON.stringify(trail), exc.line_id, exc.vendor);
      db.prepare("UPDATE exceptions SET status='resolved', resolution=? WHERE id=?")
        .run(`buyer confirmed Rs ${value}`, id);
      return NextResponse.json({ ok: true });
    }
    if (action === "ask") {
      db.prepare("UPDATE exceptions SET status='asked', resolution='clarification email drafted to vendor' WHERE id=?").run(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } finally {
    db.close();
  }
}
