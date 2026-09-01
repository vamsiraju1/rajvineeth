import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import sharp from "sharp";

export const dynamic = "force-dynamic";

// Row-band provenance crop for photo-sourced cells: deskew, then cut a horizontal
// band around the anchored row index. The skew angle is estimated once per image at
// ingest time from the card's ruled lines; this prototype stores it as a constant.
// (We deliberately do NOT use model-reported bounding boxes — they drift on angled
// photos, and a confidently wrong highlight is worse for trust than a generous band.)
const ESTIMATED_SKEW_DEG = 6.3;
const CARD_LAYOUT = { top: 210, rowH: 46, width: 1500 }; // printed card's row geometry (px, pre-rotation)

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const row = parseInt(searchParams.get("row") || "0", 10);
  const file = path.join(process.cwd(), "data", "inbox", "shreebalaji-ratecard.jpg");
  if (!fs.existsSync(file) || !row) return new NextResponse("not found", { status: 404 });

  const deskewed = await sharp(file).rotate(-ESTIMATED_SKEW_DEG, { background: "#8a857c" }).toBuffer();
  const meta = await sharp(deskewed).metadata();
  // After rotate(+θ) then rotate(-θ), the original content sits centered in a larger canvas.
  const rotOnce = await sharp(file).metadata();
  void rotOnce;
  const offX = Math.round((meta.width - CARD_LAYOUT.width) / 2);
  const contentH = meta.height; // generous: we only need y math relative to content box
  const origH = CARD_LAYOUT.top + CARD_LAYOUT.rowH * 30 + 120;
  const offY = Math.round((contentH - origH) / 2);
  const y = Math.max(0, offY + CARD_LAYOUT.top + (row - 1) * CARD_LAYOUT.rowH - 26);
  const h = Math.min(CARD_LAYOUT.rowH + 58, meta.height - y);
  const x = Math.max(0, offX - 10);
  const w = Math.min(CARD_LAYOUT.width + 20, meta.width - x);

  const band = await sharp(deskewed)
    .extract({ left: x, top: y, width: w, height: h })
    .resize({ width: 980 })
    .jpeg({ quality: 82 })
    .toBuffer();
  return new NextResponse(band, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
