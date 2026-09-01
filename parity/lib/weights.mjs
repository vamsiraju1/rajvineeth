// Deterministic box-weight model. This is the "physics" behind per-kg -> per-piece
// conversion. Inputs come from the RFx line spec; the result is always carried as an
// estimate with a band, never as fact (converter billing weights vary with flute
// take-up, flap allowances and trim).

export const FLUTE_TAKEUP = 1.45; // typical B/C flute take-up factor
export const WEIGHT_BAND_PCT = 8; // +/- band shown on every computed weight

// Blank area in m^2 for a Regular Slotted Container (RSC): one wrap of the
// perimeter plus glue flap, times (W + H) plus slotting allowance.
export function rscBlankAreaM2(dims) {
  const [L, W, H] = dims.map((mm) => mm / 1000);
  return (2 * L + 2 * W + 0.04) * (W + H + 0.03);
}

// Die-cut mailer blank: cross-shaped blank approximated as (L+2H) x (W+2H) + tabs.
export function mailerBlankAreaM2(dims) {
  const [L, W, H] = dims.map((mm) => mm / 1000);
  return (L + 2 * H + 0.06) * (W + 2 * H + 0.06);
}

// Board grammage in g/m^2 from ply construction.
export function boardGsm(ply, linerGsm, fluteGsm) {
  if (ply === 3) return 2 * linerGsm + FLUTE_TAKEUP * fluteGsm;
  if (ply === 5) return 3 * linerGsm + 2 * FLUTE_TAKEUP * fluteGsm;
  if (ply === 7) return 4 * linerGsm + 3 * FLUTE_TAKEUP * fluteGsm;
  throw new Error(`unsupported ply ${ply}`);
}

export function boxWeightKg(line) {
  const area =
    line.style === "die-cut mailer"
      ? mailerBlankAreaM2(line.dims_mm)
      : rscBlankAreaM2(line.dims_mm);
  const gsm = boardGsm(line.ply, line.liner_gsm, line.flute_gsm);
  return +(area * (gsm / 1000)).toFixed(3);
}

export function weightTrail(line) {
  const area =
    line.style === "die-cut mailer"
      ? mailerBlankAreaM2(line.dims_mm)
      : rscBlankAreaM2(line.dims_mm);
  const gsm = boardGsm(line.ply, line.liner_gsm, line.flute_gsm);
  const kg = boxWeightKg(line);
  return {
    blank_area_m2: +area.toFixed(4),
    board_gsm: Math.round(gsm),
    weight_kg: kg,
    band_pct: WEIGHT_BAND_PCT,
    formula:
      line.style === "die-cut mailer"
        ? "(L+2H+60mm) x (W+2H+60mm) x board g/m2"
        : "(2L+2W+40mm) x (W+H+30mm) x board g/m2",
  };
}
