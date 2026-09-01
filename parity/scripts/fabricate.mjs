// Fabricates the demo dataset: the RFx (30 lines), FY26 PO history, and five vendor
// responses in deliberately messy formats. Ground-truth prices computed here are used
// ONLY to author the artifacts and to print design-target aggregates for comparison —
// the extraction pipeline never reads them.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
} from "docx";
import { boxWeightKg } from "../lib/weights.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "..", "data");
const INBOX = path.join(DATA, "inbox");
const ATT = path.join(INBOX, "attachments");
fs.mkdirSync(ATT, { recursive: true });

// ---------- seeded RNG so the dataset is reproducible ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260901);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const jitter = (lo, hi) => lo + rnd() * (hi - lo);
const r2 = (x) => Math.round(x * 100) / 100;
const r05 = (x) => Math.round(x * 20) / 20;

// ---------- RFx lines: 17 x 3-ply RSC, 10 x 5-ply masters, 3 x die-cut mailers ----------
const skuNames3 = [
  "Aloo Bhujia 12x200g shipper", "Moong Dal 12x200g shipper", "Peanut Masala 12x180g shipper",
  "Banana Chips 24x90g shipper", "Soya Sticks 24x100g shipper", "Khatta Meetha 12x350g shipper",
  "Navratan Mix 12x350g shipper", "Chana Jor 24x120g shipper", "Corn Puffs 36x60g shipper",
  "Ragi Chips 24x80g shipper", "Masala Makhana 24x70g shipper", "Bhel Kit 12x250g shipper",
  "Sev Murmura 24x150g shipper", "Dry Fruit Mix 12x150g shipper", "Jackfruit Chips 24x85g shipper",
  "Multigrain Mix 12x300g shipper", "Festive Pack 6x500g shipper",
];
const skuNames5 = [
  "Master carton - bhujia family", "Master carton - chips family", "Master carton - namkeen mix",
  "Master carton - puffs", "Master carton - makhana", "Master carton - export namkeen",
  "Master carton - gifting", "Master carton - bhel kits", "Master carton - dal snacks",
  "Master carton - assorted promo",
];
const skuNamesDC = [
  "E-comm mailer S (die-cut)", "E-comm mailer M (die-cut)", "E-comm mailer L (die-cut)",
];

const lines = [];
for (let i = 0; i < 17; i++) {
  const dims = [Math.round(jitter(300, 450) / 5) * 5, Math.round(jitter(200, 350) / 5) * 5, Math.round(jitter(150, 300) / 5) * 5];
  lines.push({
    id: `L${String(i + 1).padStart(2, "0")}`, description: skuNames3[i], style: "RSC", ply: 3,
    dims_mm: dims, liner_gsm: pick([120, 140, 150]), flute_gsm: pick([100, 112, 120]), bf: pick([18, 20, 22]),
    plant: i % 3 === 2 ? "Hosur" : "Bhiwandi", uom: "piece",
  });
}
for (let i = 0; i < 10; i++) {
  const dims = [Math.round(jitter(380, 430) / 5) * 5, Math.round(jitter(280, 320) / 5) * 5, Math.round(jitter(280, 330) / 5) * 5];
  lines.push({
    id: `L${String(i + 18).padStart(2, "0")}`, description: skuNames5[i], style: "RSC", ply: 5,
    dims_mm: dims, liner_gsm: 150, flute_gsm: pick([112, 120]), bf: 22,
    plant: i % 2 === 0 ? "Bhiwandi" : "Hosur", uom: "piece",
  });
}
const dcDims = [[320, 240, 90], [360, 280, 110], [420, 320, 130]];
for (let i = 0; i < 3; i++) {
  lines.push({
    id: `L${String(i + 28).padStart(2, "0")}`, description: skuNamesDC[i], style: "die-cut mailer", ply: 3,
    dims_mm: dcDims[i], liner_gsm: 150, flute_gsm: 120, bf: 22,
    plant: "Bhiwandi", uom: "piece",
  });
}
for (const l of lines) l.weight_kg = boxWeightKg(l);

// FY26 (last year) dims for the die-cuts were DIFFERENT — new artwork this year.
const fy26DimsDC = { L28: [300, 220, 80], L29: [340, 260, 100], L30: [400, 300, 120] };

// ---------- last-year (baseline) prices: per-kg rates FY26 ----------
const LY_RATE = { 3: 36.5, 5: 40.0 };
const lyPrice = (l) => r05(l.weight_kg * LY_RATE[l.ply] + (l.style === "die-cut mailer" ? 1.2 : 0));
for (const l of lines) {
  const wLY = l.style === "die-cut mailer" ? boxWeightKg({ ...l, dims_mm: fy26DimsDC[l.id] }) : l.weight_kg;
  l.ly_price = r05(wLY * LY_RATE[l.ply] + (l.style === "die-cut mailer" ? 1.2 : 0));
}

// ---------- quantities, scaled so baseline annual spend ~ Rs 4.1 Cr ----------
for (const l of lines) {
  l.qty_month = l.ply === 5 ? Math.round(jitter(2500, 6000) / 100) * 100
    : l.style === "die-cut mailer" ? Math.round(jitter(9000, 16000) / 100) * 100
    : Math.round(jitter(6000, 18000) / 100) * 100;
}
let spend = lines.reduce((s, l) => s + l.ly_price * l.qty_month * 12, 0);
const scale = 41_000_000 / spend;
for (const l of lines) l.qty_month = Math.max(500, Math.round((l.qty_month * scale) / 500) * 500);
spend = lines.reduce((s, l) => s + l.ly_price * l.qty_month * 12, 0);

// ---------- RFx json ----------
const FX_PIN = 88.4;
const rfx = {
  event: "SVD/RFQ/FY27/CORR-01",
  buyer: "Svaad Foods Pvt Ltd",
  category: "Corrugated boxes — FY27 annual rate contract",
  plants: ["Bhiwandi", "Hosur"],
  issued: "2026-08-18",
  due: "2026-08-29",
  terms: {
    price_basis: "Per piece, INR, FOR destination plant, GST extra as applicable (HSN 4819)",
    payment: "45 days credit from GRN",
    validity: "Rates firm for 12 months; quarterly review against kraft paper index",
    rejection_tolerance: "2%",
  },
  questionnaire: [
    { key: "is2771", label: "Conformance to IS 2771 (declaration)" },
    { key: "test_report", label: "NABL-lab BF/ECT test report attached" },
    { key: "fsc", label: "FSC chain-of-custody certificate" },
    { key: "ppm", label: "Defect commitment <= 2,000 PPM" },
    { key: "backup", label: "Backup capacity / second line declared" },
    { key: "credit45", label: "Acceptance of 45-day credit" },
  ],
  fx_pin: { currency: "USD", rate_inr: FX_PIN, source: "RBI reference rate, pinned 2026-09-01" },
  freight_lanes_inr_per_kg: { "Taloja->Bhiwandi": 0.9, "Taloja->Hosur": 6.8 },
  lines: lines.map(({ ly_price, ...keep }) => keep),
};
fs.writeFileSync(path.join(DATA, "rfx.json"), JSON.stringify(rfx, null, 2));

// ---------- PO history csv (FY26) — used by the spec-delta check ----------
const poRows = [["line_id","description","style","ply","dims_mm","po_number","po_date","unit_price_inr","vendor"]];
for (const l of lines) {
  const dims = l.style === "die-cut mailer" ? fy26DimsDC[l.id] : l.dims_mm;
  poRows.push([l.id, l.description, l.style, l.ply, dims.join("x"),
    `PO-45${String(Math.floor(rnd() * 90) + 10)}${l.id.slice(1)}`, `2026-0${pick([1,2,3])}-1${Math.floor(rnd()*9)}`,
    l.ly_price.toFixed(2), "Ganpati Boards"]);
}
fs.writeFileSync(path.join(DATA, "po-history.csv"), poRows.map((r) => r.join(",")).join("\n"));

// Incumbent vendor file: Ganpati's FY26 questionnaire answers (4 of 6 items; FSC and
// fresh test report were not part of last year's RFQ).
fs.writeFileSync(path.join(DATA, "vendor-file.json"), JSON.stringify({
  "Ganpati Boards": {
    fy26_questionnaire: { is2771: "Yes (FY26 declaration)", ppm: "1,800 PPM committed FY26", backup: "Second corrugator line, Taloja", credit45: "Accepted FY26" },
  },
}, null, 2));

// ---------- ground-truth vendor pricing ----------
const gt = {}; // gt[vendor][line_id] = { inr_pc_landed_equiv, ... } for design-target math only
const setGT = (v, l, val) => ((gt[v] ??= {}), (gt[v][l] = val));

// Sunrise: all 30, per piece, FOR. Strong on 5-ply/die-cut.
const sunrise = {};
for (const l of lines) {
  const m = l.ply === 5 ? jitter(0.93, 0.97) : l.style === "die-cut mailer" ? jitter(0.93, 0.96) : jitter(0.96, 1.01);
  const p = r05(lyPrice(l) * m);
  sunrise[l.id] = p; setGT("Sunrise Packaging", l.id, p);
}
// Meghdoot: 27/30 (declines die-cuts), per piece, FOR. Strong 3-ply.
const meghdoot = {};
for (const l of lines) {
  if (l.style === "die-cut mailer") continue;
  const m = l.ply === 3 ? jitter(0.93, 0.98) : jitter(0.98, 1.03);
  const p = r05(lyPrice(l) * m);
  meghdoot[l.id] = p; setGT("Meghdoot Corrugators", l.id, p);
}
// Kwality (Hosur EOU): USD per 100 pcs, FOR, all 30. Cheap on Hosur lines, dear on Bhiwandi.
// Design the FX flip: pick 6 Hosur lines it wins at 88.40; 4 by <2.5% margin (flip at 91), 2 by >4.5%.
const hosurLines = lines.filter((l) => l.plant === "Hosur").map((l) => l.id);
const winners = hosurLines.slice(0, 6);
const flipWinners = new Set(winners.slice(0, 4));
const safeWinners = new Set(winners.slice(4, 6));
const kwality = {};
for (const l of lines) {
  let inr;
  const best = Math.min(...[sunrise[l.id], meghdoot[l.id]].filter((x) => x != null));
  if (safeWinners.has(l.id)) inr = best * jitter(0.94, 0.955);
  else if (flipWinners.has(l.id)) inr = best * jitter(0.978, 0.995);
  else if (l.plant === "Hosur") inr = best * jitter(1.0, 1.03);
  else inr = lyPrice(l) * jitter(1.04, 1.09);
  const usd100 = r2((inr * 100) / FX_PIN);
  kwality[l.id] = usd100; setGT("Kwality Kartons", l.id, r2((usd100 * FX_PIN) / 100));
}
// Shree Balaji: photo rate card, per pc, all 30. Cheapest on many 3-ply.
const balaji = {};
for (const l of lines) {
  const m = l.ply === 3 && l.style === "RSC" ? jitter(0.88, 0.93) : l.ply === 5 ? jitter(0.97, 1.0) : jitter(0.95, 0.98);
  const p = r05(lyPrice(l) * m);
  balaji[l.id] = p; setGT("Shree Balaji Packers", l.id, p);
}
// Ganpati: per-kg fresh rates on RSC; die-cuts "same as last year" -> blocked (dims changed).
const GP_RATE = { 3: 38, 5: 42 };
for (const l of lines) {
  if (l.style === "die-cut mailer") continue;
  const lane = rfx.freight_lanes_inr_per_kg[`Taloja->${l.plant}`];
  setGT("Ganpati Boards", l.id, r2(l.weight_kg * GP_RATE[l.ply] + l.weight_kg * lane));
}

// ---------- design-target aggregates (printed; pipeline must reproduce from extraction) ----------
function aggregates(fx = FX_PIN) {
  const kw = (id) => r2((kwality[id] * fx) / 100);
  const vendorsPrice = (id, includeBalaji) => {
    const cands = [
      ["Sunrise Packaging", sunrise[id]],
      ["Meghdoot Corrugators", meghdoot[id]],
      ["Kwality Kartons", kw(id)],
      includeBalaji ? ["Shree Balaji Packers", balaji[id]] : null,
      ["Ganpati Boards", gt["Ganpati Boards"][id]],
    ].filter((x) => x && x[1] != null);
    cands.sort((a, b) => a[1] - b[1]);
    return cands[0];
  };
  let naive = 0, compliant = 0, kwWins = [];
  for (const l of lines) {
    const [nv, np] = vendorsPrice(l.id, true);
    naive += np * l.qty_month * 12;
    const [cv, cp] = vendorsPrice(l.id, false);
    compliant += cp * l.qty_month * 12;
    if (cv === "Kwality Kartons") kwWins.push(l.id);
  }
  const singleSunrise = lines.reduce((s, l) => s + sunrise[l.id] * l.qty_month * 12, 0);
  return { naive, compliant, kwWins, singleSunrise };
}
const a88 = aggregates(FX_PIN);
const a91 = aggregates(91);
const targets = {
  baseline_ly: spend,
  naive_split: a88.naive,
  compliant_split: a88.compliant,
  single_sunrise_std: a88.singleSunrise,
  single_sunrise_earlypay: a88.singleSunrise * 0.98,
  kwality_wins_at_88_40: a88.kwWins,
  kwality_wins_at_91: a91.kwWins,
  compliant_at_91: a91.compliant,
};
fs.writeFileSync(path.join(DATA, "design-targets.json"), JSON.stringify(targets, null, 2));

const cr = (x) => `Rs ${(x / 1e7).toFixed(2)} Cr`;
console.log("=== DESIGN TARGETS (ground truth; pipeline must reproduce) ===");
console.log("Baseline (last year):", cr(targets.baseline_ly));
console.log("Naive cheapest split:", cr(targets.naive_split), `(${(100 * (targets.naive_split / targets.baseline_ly - 1)).toFixed(1)}%)`);
console.log("Compliant split:     ", cr(targets.compliant_split), `(${(100 * (targets.compliant_split / targets.baseline_ly - 1)).toFixed(1)}%)`);
console.log("Single vendor (Sunrise, std terms):", cr(targets.single_sunrise_std));
console.log("Kwality wins @88.40:", a88.kwWins.join(","), " @91:", a91.kwWins.join(","));
console.log("Compliant @91 delta:", cr(a91.compliant - a88.compliant));

// ============================================================================
// ARTIFACT 1 — Sunrise Packaging: beautiful Excel, own template, cell comment
// ============================================================================
async function buildSunrise() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Quotation");
  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = "SUNRISE PACKAGING INDUSTRIES — BHIWANDI";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1F4E9E" } };
  ws.mergeCells("A2:H2");
  ws.getCell("A2").value = "Quotation ref SPI/Q/2617 dt 27.08.2026 | Against: SVD/RFQ/FY27/CORR-01 | Contact: Prakash 98200xxxxx";
  ws.getCell("A2").font = { italic: true, size: 9 };
  ws.addRow([]);
  const hdr = ws.addRow(["Sr", "SPI Code", "Buyer SKU / Description", "Size (mm)", "Board", "Rate/Pc (Rs.)", "MOQ (pcs)", "Remarks"]);
  hdr.font = { bold: true };
  hdr.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEBF0FA" } }));
  const moqChanges = new Set(["L05", "L13", "L21"]);
  lines.forEach((l, i) => {
    const row = ws.addRow([
      i + 1,
      `SPI-${1400 + i * 7}`,
      `${l.id} ${l.description}`,
      l.dims_mm.join("x"),
      `${l.ply}P ${l.liner_gsm}/${l.flute_gsm} ${l.bf}BF`,
      sunrise[l.id],
      moqChanges.has(l.id) ? 5000 : 2000,
      moqChanges.has(l.id) ? "MOQ revised — die/print plate economics" : "",
    ]);
    row.getCell(6).numFmt = "0.00";
  });
  // The discount hides in a cell note on the rate header.
  ws.getCell("F4").note = {
    texts: [{ text: "Rates net FOR destination. Additional 2% discount if payment within 10 days of invoice date." }],
  };
  ws.addRow([]);
  ws.addRow(["", "", "GST @5% extra as applicable (HSN 4819). Freight included (FOR Bhiwandi / Hosur as per SKU).", "", "", "", "", ""]);
  ws.addRow(["", "", "Rates firm 12 months subject to kraft index band +/-4%.", "", "", "", "", ""]);
  ws.columns.forEach((c, i) => (c.width = [5, 10, 34, 13, 16, 12, 10, 30][i] || 12));

  const qs = wb.addWorksheet("Questionnaire");
  qs.addRow(["Item", "Response"]).font = { bold: true };
  qs.addRow(["Conformance to IS 2771", "Yes — declaration enclosed in quote"]);
  qs.addRow(["NABL BF/ECT test report", "Yes — in-house lab report available on request; NABL report from Apr-2026 audit"]);
  qs.addRow(["FSC chain of custody", "Yes — FSC certified (certificate attached: sunrise-fsc-coc.pdf)"]);
  qs.addRow(["Defect PPM commitment", "Committed <= 1,500 PPM"]);
  qs.addRow(["Backup capacity", "Two corrugator lines, Bhiwandi + Palghar"]);
  qs.addRow(["45-day credit", "Accepted"]);
  qs.columns.forEach((c, i) => (c.width = [30, 70][i]));
  await wb.xlsx.writeFile(path.join(INBOX, "sunrise-quote.xlsx"));
}

// ============================================================================
// ARTIFACT 2 — Meghdoot Corrugators: PDF on letterhead, discount in footnote 3
// ============================================================================
function buildMeghdoot() {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const out = fs.createWriteStream(path.join(INBOX, "meghdoot-quote.pdf"));
    doc.pipe(out);
    doc.fillColor("#7A1F1F").fontSize(19).font("Helvetica-Bold").text("MEGHDOOT CORRUGATORS PVT LTD", { align: "center" });
    doc.fontSize(8.5).font("Helvetica").fillColor("#444")
      .text("Plot 44, MIDC Chakan Phase II, Pune 410501 | GSTIN 27AABCM4412F1Z2 | sales@meghdootcorr.in", { align: "center" });
    doc.moveDown(0.4);
    doc.moveTo(42, doc.y).lineTo(553, doc.y).strokeColor("#7A1F1F").lineWidth(1.5).stroke();
    doc.moveDown(0.8);
    doc.fillColor("#000").fontSize(10)
      .text("Ref: MC/QTN/26-27/0912                                                     Date: 28-Aug-2026");
    doc.moveDown(0.5);
    doc.text("To, The Purchase Manager, Svaad Foods Pvt Ltd — Bhiwandi & Hosur");
    doc.moveDown(0.5);
    doc.text("Sub: Quotation against RFQ SVD/RFQ/FY27/CORR-01");
    doc.moveDown(0.5);
    doc.text("Dear Sir/Madam,", { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(9.5).text(
      "We thank you for the captioned enquiry and are pleased to quote as under. Rates are per piece in INR, " +
      "FOR your destination plant, GST @5% extra (HSN 4819). We regret our inability to quote for the die-cut " +
      "e-comm mailers (L28, L29, L30) at present as our die-cutting section is under capacity expansion. " +
      "Please refer notes below.", { align: "justify" });
    doc.moveDown(0.6);
    // table
    const startX = 42; let y = doc.y;
    const cols = [30, 200, 62, 90, 60];
    const headers = ["Sr", "Item (Buyer SKU)", "Ply", "Size (mm)", "Rate/pc"];
    doc.font("Helvetica-Bold").fontSize(8.5);
    let x = startX;
    headers.forEach((h, i) => { doc.text(h, x + 2, y, { width: cols[i] - 4 }); x += cols[i]; });
    y += 13; doc.moveTo(startX, y - 2).lineTo(startX + cols.reduce((a, b) => a + b), y - 2).lineWidth(0.5).strokeColor("#999").stroke();
    doc.font("Helvetica").fontSize(8.3);
    let sr = 1;
    for (const l of lines) {
      if (meghdoot[l.id] == null) continue;
      if (y > 760) { doc.addPage(); y = 50; }
      x = startX;
      const vals = [String(sr++), `${l.id}  ${l.description}`, `${l.ply}-ply`, l.dims_mm.join(" x "), meghdoot[l.id].toFixed(2)];
      vals.forEach((v, i) => { doc.text(v, x + 2, y, { width: cols[i] - 4 }); x += cols[i]; });
      y += 12.5;
    }
    doc.moveDown(1.2);
    doc.fontSize(8.5).font("Helvetica-Bold").text("Notes:", startX, y + 8);
    doc.font("Helvetica").fontSize(8);
    doc.text("1. Payment: 45 days from GRN accepted. Validity: 90 days from date of this quotation.", startX);
    doc.text("2. NABL laboratory BF/ECT test report for our board grades is attached (meghdoot-bfect-report.pdf).", startX);
    doc.text("3. An additional discount of 5% on invoice value shall apply on quarterly offtake above Rs 75,00,000 (Rupees seventy five lakh).", startX);
    doc.text("4. IS 2771 conformance: yes. Defect commitment: 2,000 PPM. Backup: sister unit at Ranjangaon. 45-day credit: accepted. FSC CoC: application under process, expected Q4.", startX);
    doc.moveDown(1);
    doc.text("Thanking you, for Meghdoot Corrugators Pvt Ltd — (Authorised Signatory)", startX);
    doc.end();
    out.on("finish", resolve);
  });
}

// ============================================================================
// ARTIFACT 3 — Kwality Kartons: Word doc, commercials in prose, USD per 100 pcs
// ============================================================================
async function buildKwality() {
  const para = (t, opts = {}) => new Paragraph({ children: [new TextRun({ text: t, size: 21, ...opts })], spacing: { after: 120 } });
  const rows = [
    new TableRow({
      children: ["Buyer SKU", "Description", "Size (mm)", "USD / 100 pcs"].map(
        (h) => new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })] })] }),
      ),
    }),
    ...lines.map((l) => new TableRow({
      children: [l.id, l.description, l.dims_mm.join(" x "), kwality[l.id].toFixed(2)].map(
        (v) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(v), size: 20 })] })] }),
      ),
    })),
  ];
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "KWALITY KARTONS (INDIA)", bold: true, size: 30 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "100% EOU unit — SIPCOT Industrial Growth Centre, Hosur, TN | Ref KK/EXP/2026/447 | 29 Aug 2026", italics: true, size: 18 })], spacing: { after: 240 } }),
        para("Dear Purchase Team, Svaad Foods,"),
        para("We refer to your RFQ SVD/RFQ/FY27/CORR-01 and submit our offer for all thirty items. As an export-oriented unit our price lists are maintained in US Dollars; accordingly the rates in the schedule below are quoted in USD per one hundred pieces. Kindly convert at your reference exchange rate for comparison."),
        para("Commercial terms: delivery FOR your destination plant (Hosur and Bhiwandi) with freight included in the quoted rates; GST at the applicable rate shall be charged extra; payment at 45 (forty-five) days from GRN is accepted; rates shall remain firm for twelve months subject to a mutually agreed quarterly review against the kraft paper index; defects shall not exceed 2,000 PPM; we confirm conformance of our board and cartons to IS 2771 and enclose our conformance letter together with our laboratory test certificate (kwality-is2771.pdf). We operate two corrugation lines at Hosur providing backup capacity. We do not presently hold FSC chain-of-custody certification."),
        para("Rate schedule:"),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        para(""),
        para("We trust the above is in line with your requirements and remain at your disposal for any clarification. Yours faithfully, for Kwality Kartons (India) — V. Shanmugam, GM Sales."),
      ],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(INBOX, "kwality-quote.docx"), buf);
}

// ============================================================================
// ARTIFACT 4 — Shree Balaji Packers: angled phone photo of printed rate card
// ============================================================================
async function buildBalajiPhoto() {
  const rowH = 46, top = 210, W = 1500, H = top + rowH * 30 + 120;
  let rowsSvg = "";
  lines.forEach((l, i) => {
    const y = top + i * rowH;
    const price = balaji[l.id].toFixed(2);
    // L09: smudge the last digit before the decimal; L22: blot most of the price.
    let priceSvg;
    if (l.id === "L09") {
      const s = price; // e.g. "11.80"
      priceSvg = `<text x="1280" y="${y + 30}" class="p">${s.slice(0, s.length - 4)}</text>` +
        `<text x="1355" y="${y + 30}" class="p" opacity="0.55" filter="url(#smear)">${s.slice(-4, -3)}</text>` +
        `<text x="1382" y="${y + 30}" class="p">${s.slice(-3)}</text>` +
        `<ellipse cx="1362" cy="${y + 20}" rx="26" ry="16" fill="#3a3a3a" opacity="0.42" filter="url(#blur2)"/>`;
    } else if (l.id === "L22") {
      priceSvg = `<text x="1280" y="${y + 30}" class="p" filter="url(#blur3)" opacity="0.5">${price}</text>` +
        `<ellipse cx="1330" cy="${y + 18}" rx="75" ry="20" fill="#4a3c2a" opacity="0.5" filter="url(#blur2)"/>`;
    } else {
      priceSvg = `<text x="1280" y="${y + 30}" class="p">${price}</text>`;
    }
    rowsSvg += `
      <line x1="60" y1="${y + 40}" x2="${W - 60}" y2="${y + 40}" stroke="#bbb" stroke-width="1"/>
      <text x="75"  y="${y + 30}" class="c">${l.id}</text>
      <text x="180" y="${y + 30}" class="c">${l.description.slice(0, 34)}</text>
      <text x="880" y="${y + 30}" class="c">${l.dims_mm.join("x")}</text>
      <text x="1130" y="${y + 30}" class="c">${l.ply}P</text>
      ${priceSvg}`;
  });
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="blur2"><feGaussianBlur stdDeviation="4"/></filter>
      <filter id="blur3"><feGaussianBlur stdDeviation="3"/></filter>
      <filter id="smear"><feGaussianBlur stdDeviation="2.2"/></filter>
    </defs>
    <style>
      .h { font: 700 42px Georgia, serif; fill: #222; }
      .s { font: 400 24px Georgia, serif; fill: #444; }
      .th { font: 700 26px Georgia, serif; fill: #333; }
      .c { font: 400 26px "Courier New", monospace; fill: #2a2a2a; }
      .p { font: 700 27px "Courier New", monospace; fill: #1a1a1a; }
    </style>
    <rect width="${W}" height="${H}" fill="#f6f2e8"/>
    <text x="80" y="70" class="h">SHREE BALAJI PACKERS — VASAI (E)</text>
    <text x="80" y="110" class="s">RATE CARD (Rs. per pc) w.e.f. 01.08.2026 — FOR buyer godown. GST 5% extra. Ph: 98211xxxxx</text>
    <text x="80" y="150" class="s">Against Svaad Foods RFQ FY27 — all thirty items as per your list.</text>
    <text x="75" y="${top - 15}" class="th">SKU</text>
    <text x="180" y="${top - 15}" class="th">Item</text>
    <text x="880" y="${top - 15}" class="th">Size</text>
    <text x="1130" y="${top - 15}" class="th">Ply</text>
    <text x="1280" y="${top - 15}" class="th">Rate</text>
    <line x1="60" y1="${top - 5}" x2="${W - 60}" y2="${top - 5}" stroke="#333" stroke-width="2"/>
    ${rowsSvg}
    <text x="80" y="${H - 40}" class="s">Terms: transport ours. Payment 30 days. — Balaji</text>
  </svg>`;
  const flat = await sharp(Buffer.from(svg)).png().toBuffer();
  // Perspective-ish mess: rotate, uneven lighting, slight blur, jpeg artifacts.
  const rotated = await sharp(flat)
    .rotate(6.3, { background: "#8a857c" })
    .blur(0.7)
    .modulate({ brightness: 0.96 })
    .toBuffer();
  const meta = await sharp(rotated).metadata();
  const shade = `<svg width="${meta.width}" height="${meta.height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.28"/>
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.34"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  await sharp(rotated)
    .composite([{ input: Buffer.from(shade) }])
    .jpeg({ quality: 62 })
    .toFile(path.join(INBOX, "shreebalaji-ratecard.jpg"));
}

// ============================================================================
// ARTIFACT 5 — Ganpati Boards: the one-line email
// ============================================================================
function buildGanpati() {
  fs.writeFileSync(path.join(INBOX, "ganpati-email.txt"),
`From: Suresh Toshniwal <suresh@ganpatiboards.co.in>
To: purchase@svaadfoods.in
Date: Sat, 29 Aug 2026 18:41
Subject: RE: RFQ FY27 corrugated - Svaad

42/kg for the 5 ply, 38 for the 3 ply, rest same as last year, freight extra.

rgds
Suresh
Ganpati Boards, Taloja
`);
}

// ============================================================================
// Certificates (attachments)
// ============================================================================
function certPdf(file, titleLines, bodyLines, accent = "#1F4E9E") {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A5", margin: 36 });
    const out = fs.createWriteStream(path.join(ATT, file));
    doc.pipe(out);
    doc.rect(18, 18, doc.page.width - 36, doc.page.height - 36).lineWidth(2).strokeColor(accent).stroke();
    doc.moveDown(1);
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(15).text(titleLines[0], { align: "center" });
    doc.fillColor("#333").fontSize(10).font("Helvetica").text(titleLines[1] || "", { align: "center" });
    doc.moveDown(1.2);
    doc.fontSize(9.5);
    for (const b of bodyLines) { doc.text(b, { align: "left" }); doc.moveDown(0.35); }
    doc.end();
    out.on("finish", resolve);
  });
}

async function buildCerts() {
  await certPdf("sunrise-fsc-coc.pdf",
    ["FSC CHAIN OF CUSTODY CERTIFICATE", "Certificate SGSHK-COC-441290"],
    [
      "Certificate holder: Sunrise Packaging Industries, Bhiwandi, Maharashtra, India",
      "Scope: Purchase, storage and sale of FSC Mix corrugated board and cartons.",
      "Standard: FSC-STD-40-004 V3-1",
      "Issue date: 01 July 2021",
      "VALID UNTIL: 30 JUNE 2026",
      "Issued by: SGS Hong Kong Ltd on behalf of FSC A.C.",
    ], "#2E7D4F");
  await certPdf("meghdoot-bfect-report.pdf",
    ["NABL ACCREDITED LABORATORY TEST REPORT", "PaperTest Labs, Pune — NABL T-4471 — Report PTL/26/8812 dt 12-Jul-2026"],
    [
      "Sample: 5-ply corrugated board, 150/120 GSM construction — Meghdoot Corrugators Pvt Ltd, Chakan",
      "Bursting Strength (IS 1060): 22.4 kgf/cm2   |   Bursting Factor: 22.1",
      "Edge Crush Test (IS 4006): 6.9 kN/m",
      "Cobb 30min: 118 g/m2   |   Moisture: 7.4%",
      "Result: Conforms to declared grade. Valid for the board grade, not per-shipment.",
    ], "#7A1F1F");
  await certPdf("kwality-is2771.pdf",
    ["CONFORMANCE DECLARATION — IS 2771", "Kwality Kartons (India), Hosur — KK/QA/2026/31 dt 20-Aug-2026"],
    [
      "We declare that corrugated fibreboard boxes supplied by us conform to IS 2771 (Part 1).",
      "Supported by in-house lab results witnessed quarterly and third-party test certificate TCR/26/2291 dt 05-Aug-2026:",
      "Bursting Factor: 21.8 (5-ply construction) | ECT: 6.6 kN/m",
      "QA Head: R. Priya  |  GM: V. Shanmugam",
    ], "#8a5a00");
}

// ---------- run everything ----------
await buildSunrise();
await buildMeghdoot();
await buildKwality();
await buildBalajiPhoto();
buildGanpati();
await buildCerts();
console.log("\nArtifacts written to data/inbox/. Files:");
for (const f of fs.readdirSync(INBOX)) console.log("  ", f);
console.log("Attachments:", fs.readdirSync(ATT).join(", "));
