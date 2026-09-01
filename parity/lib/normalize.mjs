// Deterministic verification + normalization. No model calls here: agreement between
// the two extraction passes plus mechanical sanity checks decide every cell's state.
// verified = passes agree + sanity ok + only deterministic disclosed conversions
// inferred = an assumption is load-bearing (computed weight, freight estimate, carry-forward)
// missing  = not quoted, illegible, or blocked — never silently filled
import { WEIGHT_BAND_PCT, weightTrail } from "./weights.mjs";

const near = (a, b, tol = 0.005) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1);
const r2 = (x) => Math.round(x * 100) / 100;

function laneRate(rfx, city, plant) {
  const key = `${city}->${plant}`;
  if (rfx.freight_lanes_inr_per_kg[key] != null) return { rate: rfx.freight_lanes_inr_per_kg[key], key };
  if (city === plant) return { rate: 0.2, key: `${key} (local, default)` };
  return { rate: 3.5, key: `${key} (default lane est.)` };
}

function freightIsExtra(terms) {
  const f = terms.filter((t) => t.key === "freight");
  if (!f.length) return false;
  const txt = f.map((t) => t.text.toLowerCase()).join(" | ");
  if (/(included|include|ours|our account|for destination|for your|free delivery|transport ours)/.test(txt)) return false;
  return /(extra|buyer|your account|to pay|excl)/.test(txt);
}

export function normalizeVendor({ vendorMeta, passA, passB, rfx, poHistory, vendorFile, today }) {
  const cells = [];
  const exceptions = [];
  const linesById = Object.fromEntries(rfx.lines.map((l) => [l.id, l]));
  const fx = rfx.fx_pin.rate_inr;

  const quotesA = Object.fromEntries((passA.line_quotes || []).map((q) => [q.line_id, q]));
  const quotesB = Object.fromEntries((passB.line_quotes || []).map((q) => [q.line_id, q]));

  // union of terms (keyed by key+first 30 chars) — pass A wins ties
  const termMap = new Map();
  for (const t of [...(passA.terms || []), ...(passB.terms || [])]) {
    const k = `${t.key}:${t.text.slice(0, 30).toLowerCase()}`;
    if (!termMap.has(k)) termMap.set(k, t);
  }
  const terms = [...termMap.values()];
  const freightExtra = freightIsExtra(terms);

  const declined = new Set();
  for (const d of [...(passA.declines || []), ...(passB.declines || [])])
    for (const id of d.line_ids || []) declined.add(id);
  const declineReason = (passA.declines?.[0] || passB.declines?.[0])?.reason || "declined by vendor";

  const rateStatements = (passA.rate_statements?.length ? passA.rate_statements : passB.rate_statements) || [];
  const scopeStatements = (passA.scope_statements?.length ? passA.scope_statements : passB.scope_statements) || [];

  for (const line of rfx.lines) {
    const qa = quotesA[line.id];
    const qb = quotesB[line.id];
    const trail = [];
    const assumptions = [];
    let state = null, price = null, converted = 0, rawValue = null, rawUnit = null, rawCurrency = null, freightPc = null, anchor = null;
    const passAval = qa?.value ?? null, passBval = qb?.value ?? null;

    const finish = () => cells.push({
      line_id: line.id, vendor: vendorMeta.name, price, state, converted,
      raw_value: rawValue, raw_unit: rawUnit, raw_currency: rawCurrency,
      freight_per_pc: freightPc, assumptions, anchor, trail, pass_a: passAval, pass_b: passBval,
    });

    const addFreight = (basePrice, weightKg) => {
      if (!freightExtra) return basePrice;
      const { rate, key } = laneRate(rfx, vendorMeta.city, line.plant);
      freightPc = r2(weightKg * rate);
      assumptions.push({ kind: "freight_estimate", detail: `Vendor quoted freight-extra; +Rs ${freightPc}/pc estimated on lane ${key} at Rs ${rate}/kg` });
      trail.push(`+ Rs ${freightPc}/pc freight estimate (${key})`);
      return r2(basePrice + freightPc);
    };

    // ---- direct line quotes present ----
    if (qa || qb) {
      const aOk = qa && qa.legible !== false && qa.value != null;
      const bOk = qb && qb.legible !== false && qb.value != null;
      if (aOk && bOk && near(qa.value, qb.value) && qa.unit === qb.unit && qa.currency === qb.currency) {
        rawValue = qa.value; rawUnit = qa.unit; rawCurrency = qa.currency; anchor = qa.anchor;
        trail.push(`Read as ${rawValue} ${rawCurrency} ${rawUnit} — both extraction passes agree (${qa.anchor})`);
        // Conversions keep full precision; rounding happens ONCE at the end.
        let pc = rawValue;
        if (rawUnit === "per_100_pieces") { pc = rawValue / 100; converted = 1; trail.push(`÷ 100 → per piece (deterministic)`); }
        if (rawCurrency === "USD") { pc = pc * fx; converted = 1; trail.push(`× ${fx} (USD→INR at pinned RBI reference rate) → Rs ${r2(pc)}/pc`); }
        if (rawUnit === "per_kg") {
          const wt = weightTrail(line);
          pc = pc * line.weight_kg;
          assumptions.push({ kind: "computed_weight", detail: `Box weight computed ${line.weight_kg} kg ±${WEIGHT_BAND_PCT}% from spec (${wt.formula}); Rs/pc inherits the band` });
          trail.push(`× ${line.weight_kg} kg est. (±${WEIGHT_BAND_PCT}%) computed box weight → Rs ${r2(pc)}/pc`);
        }
        pc = r2(addFreight(pc, line.weight_kg));
        // sanity band from physics: a box can't sell below paper cost or way above category ceiling
        const lo = line.weight_kg * 20, hi = line.weight_kg * 75 + 8;
        if (pc < lo || pc > hi) {
          state = "missing";
          exceptions.push({
            vendor: vendorMeta.name, line_id: line.id, kind: "basis_challenge",
            title: `${line.id}: Rs ${pc}/pc fails the sanity band (Rs ${r2(lo)}–${r2(hi)} for a ${line.weight_kg} kg box) — is the basis really ${rawUnit}?`,
            detail: { readings: [rawValue], unit: rawUnit, anchor, band: [r2(lo), r2(hi)] },
          });
          finish(); continue;
        }
        price = pc;
        state = assumptions.length ? "inferred" : "verified";
        finish(); continue;
      }
      // passes disagree, or a pass flagged illegibility → exception, never a guess
      const readings = [...new Set([
        ...(qa?.candidate_readings || []), ...(qb?.candidate_readings || []),
        ...(aOk ? [qa.value] : []), ...(bOk ? [qb.value] : []),
      ])].filter((x) => x != null);
      state = "missing";
      anchor = (qa || qb).anchor;
      exceptions.push({
        vendor: vendorMeta.name, line_id: line.id, kind: "ambiguous_read",
        title: `${line.id}: the two extraction passes could not agree a value${readings.length ? ` — plausible readings: ${readings.join(" / ")}` : ""}`,
        detail: {
          readings, unit: qa?.unit || qb?.unit || "unknown", anchor,
          pass_a: { value: passAval, notes: qa?.notes }, pass_b: { value: passBval, notes: qb?.notes },
        },
      });
      finish(); continue;
    }

    // ---- declined lines ----
    if (declined.has(line.id)) {
      state = "missing";
      trail.push(`Vendor declined: ${declineReason}`);
      finish(); continue;
    }

    // ---- blanket rate statements (e.g. "42/kg for the 5 ply") ----
    const rateMatch = rateStatements.find((rs) => rs.applies_to.replace(/\s|-/g, "").toLowerCase().includes(`${line.ply}ply`));
    const scope = scopeStatements[0] || null;
    if (rateMatch && line.style === "RSC") {
      rawValue = rateMatch.value; rawUnit = "per_kg"; rawCurrency = rateMatch.currency || "INR"; anchor = rateMatch.anchor;
      const wt = weightTrail(line);
      let pc = r2(rateMatch.value * line.weight_kg);
      assumptions.push({ kind: "computed_weight", detail: `Box weight computed ${line.weight_kg} kg ±${WEIGHT_BAND_PCT}% from spec (${wt.formula})` });
      trail.push(`"${rateMatch.applies_to}: ${rateMatch.value}/kg" (${rateMatch.anchor}) × ${line.weight_kg} kg est. (±${WEIGHT_BAND_PCT}%) → Rs ${pc}/pc`);
      pc = addFreight(pc, line.weight_kg);
      price = pc; state = "inferred";
      finish(); continue;
    }

    // ---- scope statements ("rest same as last year") with the spec-delta check ----
    if (scope) {
      const po = poHistory[line.id];
      const specChanged = po && po.dims !== line.dims_mm.join("x");
      if (po && !specChanged) {
        rawValue = po.unit_price; rawUnit = "per_piece"; rawCurrency = "INR"; anchor = scope.anchor;
        assumptions.push({ kind: "carry_forward", detail: `Price carried from ${po.po_number} (${po.po_date}) under "${scope.text}" — not freshly quoted` });
        trail.push(`"${scope.text}" resolved against ${po.po_number} dt ${po.po_date}: Rs ${po.unit_price}/pc (spec unchanged)`);
        let pc = addFreight(po.unit_price, line.weight_kg);
        price = pc; state = "inferred";
        finish(); continue;
      }
      state = "missing";
      const ratePossible = rateStatements.find((rs) => rs.applies_to.replace(/\s|-/g, "").toLowerCase().includes(`${line.ply}ply`));
      const altReading = ratePossible ? ` It is also ambiguous whether "${ratePossible.applies_to} ${ratePossible.value}/kg" was meant to cover this ${line.style} (≈ Rs ${r2(ratePossible.value * line.weight_kg)}/pc if so).` : "";
      exceptions.push({
        vendor: vendorMeta.name, line_id: line.id, kind: "carry_forward_blocked",
        title: `${line.id}: "${scope.text}" cannot be resolved — dimensions changed since FY26 (${po ? po.dims : "no PO found"} → ${line.dims_mm.join("x")}), so last year's price is for a different box.${altReading}`,
        detail: { scope: scope.text, anchor: scope.anchor, fy26_dims: po?.dims || null, new_dims: line.dims_mm.join("x"), po_number: po?.po_number || null, rate_alternative: ratePossible ? { value: ratePossible.value, per_pc_if_applies: r2(ratePossible.value * line.weight_kg) } : null },
      });
      finish(); continue;
    }

    // ---- nothing covers this line ----
    state = "missing";
    finish();
  }

  // ---- questionnaire merge + attachment cross-check ----
  const MANDATORY = ["is2771", "test_report", "ppm", "credit45"];
  const qMap = new Map();
  for (const q of [...(passA.questionnaire || []), ...(passB.questionnaire || [])])
    if (!qMap.has(q.key) || (qMap.get(q.key).claimed === "absent" && q.claimed !== "absent")) qMap.set(q.key, q);
  const questionnaire = [];
  const labels = Object.fromEntries(rfx.questionnaire.map((q) => [q.key, q.label]));
  let freshAnswered = 0;
  for (const item of rfx.questionnaire) {
    const q = qMap.get(item.key);
    let status = "missing", answer = "", note = "";
    if (q && q.claimed !== "absent") {
      freshAnswered++;
      answer = q.answer_text;
      status = q.claimed === "no" ? (MANDATORY.includes(item.key) ? "fail" : "pass") : "pass";
      if (q.claimed === "no") note = "vendor answered no";
      if (q.claimed === "partial") { status = "pass"; note = "partial"; }
    } else if (vendorFile?.fy26_questionnaire?.[item.key]) {
      status = "inferred";
      answer = vendorFile.fy26_questionnaire[item.key];
      note = "carried from FY26 vendor file — not freshly answered";
    }
    questionnaire.push({ vendor: vendorMeta.name, item: item.key, label: labels[item.key], answer, status, note });
  }
  const questionnaireReturned = freshAnswered > 0 ? 1 : 0;

  const mandatoryStates = questionnaire.filter((q) => MANDATORY.includes(q.item));
  const fails = mandatoryStates.filter((q) => q.status === "fail").length;
  const missingMand = mandatoryStates.filter((q) => q.status === "missing").length;
  const inferredMand = mandatoryStates.filter((q) => q.status === "inferred").length;
  const compliantDefault = fails === 0 && missingMand <= 1 && (questionnaireReturned || inferredMand > 0) ? 1 : 0;
  const compliantStrict = fails === 0 && missingMand === 0 && inferredMand === 0 && questionnaireReturned ? 1 : 0;
  const complianceNote =
    !questionnaireReturned && !inferredMand ? "questionnaire not returned — excluded from compliant scenarios"
    : inferredMand ? `${inferredMand} mandatory item(s) carried from FY26 file; ${missingMand} missing — included by default, excluded in strict mode`
    : missingMand ? `${missingMand} mandatory item(s) unanswered`
    : "cleared";

  return {
    cells, exceptions, terms: terms.map((t) => ({ ...t, vendor: vendorMeta.name })),
    questionnaire, questionnaireReturned, compliantDefault, compliantStrict, complianceNote,
    coverage: cells.filter((c) => c.price != null).length,
  };
}

// Cross-check questionnaire claims against extracted attachments; returns flags.
export function attachmentFlags({ vendorName, questionnaire, certByFile, attachmentsReferenced, today }) {
  const flags = [];
  for (const q of questionnaire) {
    if (q.status === "missing") continue;
    const ref = (attachmentsReferenced || []).find((f) => {
      const kind = certByFile[f]?.kind?.toLowerCase() || "";
      if (q.item === "fsc") return /fsc|chain of custody/.test(kind) || /fsc/.test(f);
      if (q.item === "test_report") return /test|nabl|report/.test(kind) || /report|test/.test(f);
      if (q.item === "is2771") return /2771|conformance/.test(kind) || /2771/.test(f);
      return false;
    });
    if (!ref) continue;
    const cert = certByFile[ref];
    if (cert?.valid_until && cert.valid_until < today) {
      flags.push({
        vendor: vendorName, item: q.item, file: ref,
        note: `claims "${q.label}" but the attached ${cert.kind} EXPIRED ${cert.valid_until}`,
      });
    }
  }
  return flags;
}
