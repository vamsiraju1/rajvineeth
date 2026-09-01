// The analyst conversation: a tool-using agent over the typed quote store.
// The model NEVER does arithmetic on text — it writes read-only SQL, the engine
// computes, and the final answer is submitted through a strict tool so the UI can
// render prose, tables, charts and receipts separately. Every question, including
// improvised ones, flows through this same loop; nothing is hardcoded per question.
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { openDb, getMeta } from "./db.mjs";

dotenv.config({ path: new URL("../../.env", import.meta.url).pathname });
const MODEL = process.env.PARITY_MODEL || "claude-opus-5";
const client = new Anthropic();

const SCHEMA_DOC = `
SQLite schema (read-only; all prices are INR per piece, landed at the pinned FX rate, ex-GST):

lines(id, description, style('RSC'|'die-cut mailer'), ply, dims, plant('Bhiwandi'|'Hosur'), qty_month, annual_qty, weight_kg, weight_band_pct)
cells(line_id, vendor, price REAL|NULL, state('verified'|'inferred'|'missing'), converted(0|1 deterministic FX/per-100 conversion applied),
      raw_value, raw_unit('per_piece'|'per_100_pieces'|'per_kg'), raw_currency('INR'|'USD'), freight_per_pc, assumptions(json), anchor(json), trail(json), pass_a, pass_b)
vendors(name, city, response_file, response_kind, coverage, questionnaire_returned, compliant_default, compliant_strict, compliance_note, confirm_back_status)
terms(vendor, key('payment'|'freight'|'gst'|'discount'|'validity'|'moq'|'price_reset'|'other'), text, conditional, condition_text, anchor)
questionnaire(vendor, item, label, answer, status('pass'|'fail'|'missing'|'flagged'|'inferred'), note)
exceptions(id, vendor, line_id, kind, title, detail, status('open'|'resolved'), resolution)
attachments(vendor, filename, kind, summary, valid_until, flag)
meta(key, value) -- fx_pin, freight_lanes, run_stats, event

Semantics you MUST follow:
- Cheapest-per-line splits: pick MIN(price) per line over non-null cells of eligible vendors. Annual value = price * annual_qty.
- "Compliant" vendors: compliant_default=1 (or compliant_strict=1 in strict mode). State the filter you used and who it excludes and why (compliance_note).
- Aggregation policy: by default include verified AND inferred cells and SAY SO with counts (e.g. "built on 93 verified + 27 inferred cells; missing lines excluded"). Never invent a price for a missing cell; report lines with no eligible quote separately.
- FX what-ifs: cells quoted in USD store raw_value in USD per raw_unit. Price at a hypothetical rate R: for raw_currency='USD': raw_value*R/100 when raw_unit='per_100_pieces' (plus freight_per_pc if any). Non-USD cells do not move.
- Baseline "last year" spend is NOT in the store as prices; if asked for savings vs last year, use meta or state it if provided in context; otherwise compare scenarios to each other.
- The 2% early-payment discount (Sunrise) and 5% quarterly-offtake discount (Meghdoot) are CONDITIONAL terms — never bake them into per-line prices; model them as scenario adjustments and state the condition.
- If the data cannot answer (e.g. delivery performance, lead times), SAY the store does not hold it, offer the nearest labeled proxy if one exists, and do not guess.`;

const SYSTEM = `You are Parity's analyst — the plain-language interface over a procurement quote comparison a buyer will stake real money on. Discipline:

1. NEVER do arithmetic yourself. Every number you present must come from a run_sql result. Compose your answer around query outputs.
2. First state your constraint restatement in plain language (the filter, the mode, the cell-state policy, row counts), then the answer. Uncertainty is stated, never smoothed over.
3. Cite line ids and vendor names. Round money to the nearest rupee/lakh sensibly, but only after SQL computed it.
4. When the data cannot answer, refuse plainly and offer the nearest labeled proxy. A system that never says "I don't know" cannot be trusted when it speaks.
5. Finish by calling submit_answer exactly once. Keep answer_md tight and decision-oriented; put numbers in figures[] and tabular results in table.
${SCHEMA_DOC}`;

const TOOLS = [
  {
    name: "run_sql",
    description: "Run one read-only SELECT against the quote store. Returns rows as JSON (capped at 200).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { sql: { type: "string", description: "a single SELECT statement (WITH allowed); no writes" } },
      required: ["sql"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_answer",
    description: "Submit the final answer for rendering. Call exactly once, last.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        constraints_text: { type: "string", description: "plain-language restatement of filters/mode/cell-state policy and row counts the answer rests on" },
        answer_md: { type: "string", description: "the answer, markdown, tight and decision-oriented" },
        figures: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
            required: ["label", "value"], additionalProperties: false,
          },
        },
        table: {
          type: ["object", "null"],
          properties: {
            columns: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: { type: "string" } } },
          },
          required: ["columns", "rows"], additionalProperties: false,
        },
        chart: {
          type: ["object", "null"],
          description: "optional simple bar chart",
          properties: {
            title: { type: "string" },
            bars: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "number" } },
                required: ["label", "value"], additionalProperties: false,
              },
            },
          },
          required: ["title", "bars"], additionalProperties: false,
        },
      },
      required: ["constraints_text", "answer_md", "figures", "table", "chart"],
      additionalProperties: false,
    },
  },
];

function runReadonlySql(sql) {
  const trimmed = sql.trim().replace(/;+$/, "");
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error("Only SELECT queries are allowed.");
  if (/\b(insert|update|delete|drop|alter|create|attach|pragma|vacuum)\b/i.test(trimmed)) throw new Error("Read-only: statement rejected.");
  const db = openDb(true);
  try {
    const rows = db.prepare(trimmed).all().slice(0, 200);
    return rows;
  } finally { db.close(); }
}

export async function askAnalyst({ question, strictMode = false, history = [] }) {
  const db = openDb(true);
  const fx = JSON.parse(getMeta(db, "fx_pin"));
  const stats = JSON.parse(getMeta(db, "run_stats"));
  db.close();

  const contextLine = `Session state: compliance mode = ${strictMode ? "STRICT (compliant_strict=1)" : "DEFAULT/lenient (compliant_default=1)"}. FX pin: USD @ Rs ${fx.rate_inr} (${fx.source}). Run stats: ${stats.verified} verified / ${stats.inferred} inferred / ${stats.missing} missing cells, ${stats.exceptions} exceptions raised. Today: ${new Date().toISOString().slice(0, 10)}.`;

  const messages = [
    ...history,
    { role: "user", content: `${contextLine}\n\nBuyer's question: ${question}` },
  ];

  const receipts = [];
  let finalAnswer = null;
  let guard = 0;

  while (guard++ < 12) {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (!toolUses.length) {
      // Model answered in prose without submitting — wrap it so the UI still renders.
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      finalAnswer = { constraints_text: "", answer_md: text, figures: [], table: null, chart: null };
      break;
    }
    messages.push({ role: "assistant", content: res.content });
    const toolResults = [];
    for (const tu of toolUses) {
      if (tu.name === "submit_answer") {
        finalAnswer = tu.input;
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "submitted" });
      } else if (tu.name === "run_sql") {
        try {
          const rows = runReadonlySql(tu.input.sql);
          receipts.push({ sql: tu.input.sql, row_count: rows.length, rows: rows.slice(0, 8) });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ row_count: rows.length, rows }) });
        } catch (e) {
          receipts.push({ sql: tu.input.sql, error: String(e.message || e) });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `ERROR: ${e.message}`, is_error: true });
        }
      }
    }
    messages.push({ role: "user", content: toolResults });
    if (finalAnswer) break;
  }

  // log to the decision record
  const wdb = openDb(false);
  wdb.prepare("INSERT INTO qa_log (ts, question, constraints_text, sql_used, answer) VALUES (?,?,?,?,?)")
    .run(new Date().toISOString(), question, finalAnswer?.constraints_text || "", JSON.stringify(receipts.map((r) => r.sql)), finalAnswer?.answer_md || "");
  wdb.close();

  return { answer: finalAnswer, receipts };
}
