// The real AI loop: schema-constrained extraction of vendor responses, run twice
// independently per artifact. Confidence is measured by agreement between the two
// passes, never by asking the model for a confidence score.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import mammoth from "mammoth";

dotenv.config({ path: new URL("../../.env", import.meta.url).pathname });
const MODEL = process.env.PARITY_MODEL || "claude-opus-5";
export const client = new Anthropic();

const CACHE_DIR = new URL("../data/cache/", import.meta.url).pathname;
fs.mkdirSync(CACHE_DIR, { recursive: true });

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

// ---------- artifact -> model-readable input ----------
export async function xlsxToGridText(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  let out = "";
  wb.eachSheet((ws) => {
    out += `=== SHEET "${ws.name}" (cell grid; format CELLREF: value) ===\n`;
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const ref = cell.address;
        let v = cell.value;
        if (v && typeof v === "object" && v.richText) v = v.richText.map((t) => t.text).join("");
        if (v == null || v === "") return;
        out += `${ref}: ${v}\n`;
        if (cell.note) {
          const noteText = typeof cell.note === "string" ? cell.note
            : (cell.note.texts || []).map((t) => t.text).join("");
          out += `${ref} [CELL COMMENT/NOTE]: ${noteText}\n`;
        }
      });
      void rowNum;
    });
  });
  return out;
}

export async function buildArtifactContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === ".xlsx") {
    const grid = await xlsxToGridText(filePath);
    return { blocks: [{ type: "text", text: `The vendor sent an Excel workbook. Full cell grid below (cell references are the source anchors):\n\n${grid}` }], anchorType: "xlsx_cell" };
  }
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { blocks: [{ type: "text", text: `The vendor sent a Word document. Extracted text below (quote exact sentences as source anchors):\n\n${value}` }], anchorType: "doc_quote" };
  }
  if (ext === ".pdf") {
    return {
      blocks: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
        { type: "text", text: "The vendor sent this PDF on their letterhead. Read it fully, including every footnote and note at the bottom — commercial conditions often hide there. Use page number + exact quoted text as source anchors." },
      ], anchorType: "pdf_quote",
    };
  }
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
    return {
      blocks: [
        { type: "image", source: { type: "base64", media_type: ext === ".png" ? "image/png" : "image/jpeg", data: buf.toString("base64") } },
        { type: "text", text: "The vendor sent this photo of a printed rate card, taken at an angle on a phone. The rotation makes right-hand columns sit visually lower — align each rate to its row by following the ruled lines, not by vertical position. Some digits may be smudged or illegible: NEVER guess an illegible digit; set the value null, legible=false, and list every plausible reading in candidate_readings. Use the 1-based row index on the card as the source anchor." },
      ], anchorType: "photo_row",
    };
  }
  // plain text / email
  return { blocks: [{ type: "text", text: `The vendor replied by plain email. Full message below (quote exact sentences as source anchors):\n\n${buf.toString("utf8")}` }], anchorType: "email_quote" };
}

// ---------- extraction schema ----------
const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor_name", "overall_basis", "line_quotes", "rate_statements", "scope_statements", "terms", "questionnaire", "declines", "attachments_referenced"],
  properties: {
    vendor_name: { type: "string" },
    overall_basis: {
      type: "object", additionalProperties: false,
      required: ["unit", "currency"],
      properties: {
        unit: { type: "string", enum: ["per_piece", "per_100_pieces", "per_kg", "mixed", "unknown"] },
        currency: { type: "string", enum: ["INR", "USD", "unknown"] },
      },
    },
    line_quotes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["line_id", "value", "unit", "currency", "legible", "candidate_readings", "anchor", "notes"],
        properties: {
          line_id: { type: "string", description: "RFx line id L01..L30 this quote maps to" },
          value: { type: ["number", "null"], description: "the raw number exactly as printed — never converted" },
          unit: { type: "string", enum: ["per_piece", "per_100_pieces", "per_kg", "unknown"] },
          currency: { type: "string", enum: ["INR", "USD", "unknown"] },
          legible: { type: "boolean" },
          candidate_readings: { type: "array", items: { type: "number" }, description: "plausible readings when a digit is smudged/ambiguous" },
          anchor: { type: "string", description: "source anchor: cell ref, 'page N: exact quote', 'row N on card', or exact email sentence" },
          notes: { type: "string" },
        },
      },
    },
    rate_statements: {
      type: "array",
      description: "blanket rates not tied to one line, e.g. 'Rs 42/kg for 5-ply'",
      items: {
        type: "object", additionalProperties: false,
        required: ["applies_to", "value", "unit", "currency", "anchor"],
        properties: {
          applies_to: { type: "string", description: "e.g. '5-ply', '3-ply'" },
          value: { type: "number" }, unit: { type: "string" }, currency: { type: "string" },
          anchor: { type: "string" },
        },
      },
    },
    scope_statements: {
      type: "array",
      description: "statements that reference something outside this document, e.g. 'rest same as last year'",
      items: {
        type: "object", additionalProperties: false,
        required: ["text", "anchor", "interpretation"],
        properties: { text: { type: "string" }, anchor: { type: "string" }, interpretation: { type: "string" } },
      },
    },
    terms: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "text", "conditional", "condition", "anchor"],
        properties: {
          key: { type: "string", enum: ["payment", "freight", "gst", "discount", "validity", "moq", "price_reset", "other"] },
          text: { type: "string" },
          conditional: { type: "boolean" },
          condition: { type: ["string", "null"] },
          anchor: { type: "string" },
        },
      },
    },
    questionnaire: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "answer_text", "claimed", "attachment_ref"],
        properties: {
          key: { type: "string", enum: ["is2771", "test_report", "fsc", "ppm", "backup", "credit45"] },
          answer_text: { type: "string" },
          claimed: { type: "string", enum: ["yes", "no", "partial", "absent"] },
          attachment_ref: { type: ["string", "null"] },
        },
      },
    },
    declines: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["line_ids", "reason", "anchor"],
        properties: { line_ids: { type: "array", items: { type: "string" } }, reason: { type: "string" }, anchor: { type: "string" } },
      },
    },
    attachments_referenced: { type: "array", items: { type: "string" } },
  },
};

function rfxLineTable(rfx) {
  return rfx.lines
    .map((l) => `${l.id} | ${l.description} | ${l.style} | ${l.ply}-ply | ${l.dims_mm.join("x")}mm | plant ${l.plant}`)
    .join("\n");
}

const PASS_FRAMINGS = {
  A: "PASS FRAMING: Work through the vendor document from top to bottom, row by row / sentence by sentence, and map each thing you find onto the RFx lines.",
  B: "PASS FRAMING: Work through the RFx line list one line id at a time (L01 first, L30 last), and for each id hunt through the vendor document for its quote. Then sweep the document once more for terms, footnotes, comments, questionnaire answers and scope statements you have not yet captured.",
};

export async function extractVendor({ filePath, rfx, pass }) {
  const buf = fs.readFileSync(filePath);
  const cacheKey = path.join(CACHE_DIR, `${path.basename(filePath)}.${sha(buf)}.pass${pass}.json`);
  if (fs.existsSync(cacheKey)) return JSON.parse(fs.readFileSync(cacheKey, "utf8"));

  const { blocks } = await buildArtifactContent(filePath);
  const system = `You are the extraction stage of Parity, a procurement quote-comparison system. A buyer issued an RFx with these 30 lines:

${rfxLineTable(rfx)}

Extract this ONE vendor's response into the JSON schema. Hard rules:
- Extract RAW values exactly as printed. NEVER convert units or currency. NEVER fill a gap with a guess.
- If a number is smudged, ambiguous, or you are not certain of a digit: value=null, legible=false, and list every plausible reading in candidate_readings.
- A quote's unit matters as much as its value: per piece vs per 100 pieces vs per kg. Read the document's own words for the basis.
- Capture EVERY commercial term, including ones hidden in footnotes, cell comments/notes, and prose paragraphs. Discounts with conditions are conditional=true with the condition captured.
- Capture blanket rate statements (e.g. "42/kg for the 5 ply") in rate_statements, NOT as per-line quotes.
- Capture statements that point outside the document ("rest same as last year") in scope_statements.
- Questionnaire items to look for: is2771 (IS 2771 conformance), test_report (NABL BF/ECT report), fsc (FSC chain of custody), ppm (defect PPM commitment), backup (backup capacity), credit45 (45-day credit acceptance). claimed=absent if the vendor says nothing about an item.
- Every extracted datum carries a precise source anchor.
${PASS_FRAMINGS[pass]}`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 30000,
    system,
    messages: [{ role: "user", content: blocks }],
    output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
  });
  const res = await stream.finalMessage();
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  parsed._usage = { input: res.usage.input_tokens, output: res.usage.output_tokens, model: MODEL, pass };
  fs.writeFileSync(cacheKey, JSON.stringify(parsed, null, 2));
  return parsed;
}

// ---------- attachment (certificate) extraction: single pass, tiny schema ----------
const CERT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kind", "holder", "summary", "valid_until", "issue_date"],
  properties: {
    kind: { type: "string", description: "e.g. FSC CoC certificate, NABL test report, IS 2771 conformance declaration" },
    holder: { type: "string" },
    summary: { type: "string" },
    valid_until: { type: ["string", "null"], description: "ISO date if the document states a validity/expiry date, else null" },
    issue_date: { type: ["string", "null"] },
  },
};

export async function extractCert(filePath) {
  const buf = fs.readFileSync(filePath);
  const cacheKey = path.join(CACHE_DIR, `${path.basename(filePath)}.${sha(buf)}.cert.json`);
  if (fs.existsSync(cacheKey)) return JSON.parse(fs.readFileSync(cacheKey, "utf8"));
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
        { type: "text", text: "Extract this vendor attachment (certificate / test report) into the schema. Dates exactly as printed, ISO format." },
      ],
    }],
    output_config: { format: { type: "json_schema", schema: CERT_SCHEMA } },
  });
  const parsed = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  fs.writeFileSync(cacheKey, JSON.stringify(parsed, null, 2));
  return parsed;
}
