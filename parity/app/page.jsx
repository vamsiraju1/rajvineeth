"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const fmt = (n) => (n == null ? "—" : Number(n).toFixed(2));
const lakh = (n) => `₹${(n / 100000).toFixed(1)}L`;

// tiny markdown-lite renderer: paragraphs, **bold**, bullet lines
function Md({ text }) {
  if (!text) return null;
  const blocks = text.split(/\n{2,}/);
  return blocks.map((b, i) => {
    const lines = b.split("\n");
    const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l) || !l.trim());
    const renderInline = (s) =>
      s.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : part,
      );
    if (isList)
      return (
        <ul key={i} style={{ margin: "6px 0", paddingLeft: 18 }}>
          {lines.filter((l) => l.trim()).map((l, j) => <li key={j}>{renderInline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}
        </ul>
      );
    return <p key={i} style={{ margin: "6px 0" }}>{renderInline(b)}</p>;
  });
}

function askEmailDraft(exc, vendors) {
  const v = vendors.find((x) => x.name === exc.vendor);
  return `To: ${exc.vendor} <sales@${(exc.vendor || "vendor").toLowerCase().replace(/[^a-z]/g, "")}.in>
Subject: RFQ SVD/RFQ/FY27/CORR-01 — one clarification${exc.line_id ? ` on ${exc.line_id}` : ""}

Dear ${exc.vendor},

Thank you for your quotation (${v?.response_kind || "response"}). One point needs your confirmation before we complete the comparison:

${exc.title}

A one-line reply is enough. Everything else in your offer has been read and recorded as-is.

Regards,
Meera Kulkarni — Category Buyer, Svaad Foods (Parity)`;
}

function confirmBackDraft(vendor, lines, cells) {
  const rows = lines
    .map((l) => {
      const c = cells[`${l.id}|${vendor.name}`];
      if (!c || c.price == null) return null;
      const note = c.state === "inferred" ? "  <- includes our computed/estimated element, please verify" : "";
      return `  ${l.id}  ${fmt(c.price)} Rs/pc landed${c.raw_currency === "USD" ? ` (from your USD quote @88.40)` : ""}${c.raw_unit === "per_kg" ? ` (from your per-kg rate x ${l.weight_kg} kg est.)` : ""}${note}`;
    })
    .filter(Boolean);
  return `To: ${vendor.name}
Subject: Your quote as we read it — please confirm (RFQ SVD/RFQ/FY27/CORR-01)

This is how Parity recorded your offer after normalization (per piece, INR, landed, ex-GST):

${rows.join("\n")}

Coverage: ${vendor.coverage}/30 lines. If any figure above misstates your offer, reply with the correction — one line is enough. Silence by ${"Sep 04"} will be read as confirmation.

— Svaad Foods procurement (via Parity)`;
}

export default function Page() {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null); // {line, vendor}
  const [strict, setStrict] = useState(false);
  const [chat, setChat] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // {title, body}
  const [tab, setTab] = useState("grid");
  const [uploading, setUploading] = useState(null); // filename while ingesting
  const [uploadMsg, setUploadMsg] = useState(null);
  const chatEndRef = useRef(null);
  const fileRef = useRef(null);

  const load = () => fetch("/api/state").then((r) => r.json()).then(setData);
  useEffect(() => { load(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, busy]);

  const cellMap = useMemo(() => {
    const m = {};
    for (const c of data?.cells || []) m[`${c.line_id}|${c.vendor}`] = c;
    return m;
  }, [data]);

  const bestByLine = useMemo(() => {
    const m = {};
    for (const l of data?.lines || []) {
      let best = null;
      for (const v of data?.vendors || []) {
        const ok = strict ? v.compliant_strict : v.compliant_default;
        if (!ok) continue;
        const c = cellMap[`${l.id}|${v.name}`];
        if (c?.price != null && (best == null || c.price < best.price)) best = { vendor: v.name, price: c.price };
      }
      if (best) m[l.id] = best.vendor;
    }
    return m;
  }, [data, cellMap, strict]);

  if (!data) return <div style={{ padding: 40 }} className="mono">loading…</div>;
  if (!data.ready) return <div style={{ padding: 40 }} className="mono">{data.error}</div>;

  const { lines, vendors, exceptions, questionnaire, meta, attachments, terms } = data;
  const openExc = exceptions.filter((e) => e.status === "open");
  const stats = meta.run_stats || {};

  const ask = async (question) => {
    if (!question.trim() || busy) return;
    setQ("");
    setChat((c) => [...c, { role: "q", text: question }]);
    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, strictMode: strict }),
      }).then((x) => x.json());
      if (r.error) setChat((c) => [...c, { role: "a", answer: { answer_md: `**Error:** ${r.error}` }, receipts: [] }]);
      else setChat((c) => [...c, { role: "a", ...r }]);
    } catch (e) {
      setChat((c) => [...c, { role: "a", answer: { answer_md: `**Error:** ${String(e)}` }, receipts: [] }]);
    }
    setBusy(false);
  };

  const resolve = async (id, action, value) => {
    await fetch("/api/resolve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, value }),
    });
    load();
  };

  const uploadVendorFile = async (file) => {
    if (!file || uploading) return;
    setUploading(file.name);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd }).then((x) => x.json());
      if (r.error) setUploadMsg({ err: true, text: r.error });
      else setUploadMsg({ err: false, text: `Read "${r.vendor}": ${r.coverage}/30 lines priced, ${r.exceptions} exception(s) raised — ${r.compliance}` });
      await load();
    } catch (e) {
      setUploadMsg({ err: true, text: String(e) });
    }
    setUploading(null);
  };

  const selCell = sel ? cellMap[`${sel.line}|${sel.vendor}`] : null;
  const selLine = sel ? lines.find((l) => l.id === sel.line) : null;
  // Row-band crops are served for the reference photo artifact; uploaded photos show their text anchor.
  const photoRow = sel?.vendor === "Shree Balaji Packers" && selCell?.anchor
    ? (JSON.parse(selCell.anchor).ref || "").match(/row\s*(\d+)/i)?.[1] : null;
  const vendorOf = (name) => vendors.find((v) => v.name === name);

  const suggestions = [
    "Award each line to the cheapest vendor — include the non-compliant ones, I want the floor.",
    "Now redo it with only vendors who cleared the quality questionnaire.",
    "What if I give everything to one vendor instead? What's the premium?",
    "Why is Ganpati's L23 amber?",
    "Which lines have the thinnest quote coverage under the compliant filter?",
    "If the rupee goes to 91, does the award change?",
    "Which vendor is most reliable on delivery?",
    "Draft the award memo for the compliant split.",
  ];

  return (
    <div className="shell">
      <div className="main">
        <div className="masthead">
          <span className="wordmark">Parity</span>
          <span className="eventline">{meta.event?.event} · {meta.event?.buyer}</span>
        </div>
        <div className="subline">{meta.event?.category} — 30 lines × 5 vendors, read from whatever they sent. Landed ₹/pc, ex-GST. USD pinned @ ₹{meta.fx_pin?.rate_inr} ({meta.fx_pin?.source}).</div>

        <div className="statsbar">
          <span className="chip v">● {stats.verified} verified</span>
          <span className="chip i">● {stats.inferred} inferred</span>
          <span className="chip m">● {stats.missing} missing</span>
          <span className={`chip ${openExc.length ? "warn" : ""}`}>{openExc.length} exceptions open</span>
          <span className="chip accent">extraction: 2 passes/doc, agreement-gated</span>
          <a className="chip" href="/api/export" style={{ textDecoration: "none" }}>⤓ export xlsx</a>
          <label className="strict">
            <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
            strict compliance mode
          </label>
          <button
            className={`btn addbtn ${uploading ? "busy" : ""}`}
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); uploadVendorFile(e.dataTransfer.files?.[0]); }}
            title="Add a vendor response — drop or click. PDF / Excel / Word / photo / email text. Read live through the same pipeline."
          >
            {uploading ? <><span className="spinner" />reading {uploading.length > 18 ? uploading.slice(0, 16) + "…" : uploading}</> : "＋ Add vendor response"}
          </button>
          <input ref={fileRef} type="file" hidden accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png,.txt,.eml"
            onChange={(e) => { uploadVendorFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <div className="panelcard">
          <div className="vendorstrip">
            {vendors.map((v) => (
              <div className="vcard" key={v.name}>
                <div className="vname">{v.name}</div>
                <div className="vkind">{v.response_kind} · {v.city}</div>
                <div className="covbar"><div style={{ width: `${(v.coverage / 30) * 100}%` }} /></div>
                <div className="vmeta">{v.coverage}/30 lines{v.questionnaire_returned ? " · QQ ✓" : " · QQ not returned"}</div>
                <span className={`badge ${(strict ? v.compliant_strict : v.compliant_default) ? "ok" : "out"}`}>
                  {(strict ? v.compliant_strict : v.compliant_default) ? "IN COMPLIANT SET" : "EXCLUDED"}
                </span>
                <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 5 }}>{v.compliance_note}</div>
                <button className="btn" style={{ marginTop: 7, fontSize: 11 }}
                  onClick={() => setModal({ title: `Confirm-back — ${v.name}`, body: confirmBackDraft(v, lines, cellMap) })}>
                  confirm-back draft
                </button>
              </div>
            ))}
          </div>
          {uploadMsg && (
            <div className="panelbody" style={{ paddingTop: 0, fontSize: 12.5, color: uploadMsg.err ? "var(--danger)" : "var(--verified)" }}>
              {uploadMsg.err ? "⚠ " : "✓ "}{uploadMsg.text}
            </div>
          )}
        </div>

        <div className="panelcard">
          <div className="panelhead">
            <span style={{ cursor: "pointer", color: tab === "grid" ? "var(--accent)" : "inherit" }} onClick={() => setTab("grid")}>Comparison grid</span>
            <span style={{ cursor: "pointer", color: tab === "qq" ? "var(--accent)" : "inherit" }} onClick={() => setTab("qq")}>Questionnaire & attachments</span>
            <span style={{ cursor: "pointer", color: tab === "exc" ? "var(--accent)" : "inherit" }} onClick={() => setTab("exc")}>
              Exceptions {openExc.length ? `(${openExc.length})` : ""}
            </span>
            <span className="mono" style={{ marginLeft: "auto" }}>
              totals: common comparable basis · optimism is opt-in
            </span>
          </div>

          {tab === "grid" && (
            <div className="gridwrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ minWidth: 190 }}>Line</th>
                    <th>Plant / qty-mo</th>
                    {vendors.map((v) => <th key={v.name}>{v.name.split(" ")[0]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="linecell">
                        <span className="mono" style={{ fontSize: 11.5 }}>{l.id}</span> {l.ply}P {l.style === "die-cut mailer" ? "DC" : "RSC"}
                        <div className="desc">{l.description} · {l.dims} · {l.weight_kg}kg est</div>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>{l.plant}<br />{l.qty_month.toLocaleString("en-IN")}</td>
                      {vendors.map((v) => {
                        const c = cellMap[`${l.id}|${v.name}`];
                        const state = c?.price != null ? c.state : "missing";
                        const isSel = sel && sel.line === l.id && sel.vendor === v.name;
                        const isBest = bestByLine[l.id] === v.name;
                        return (
                          <td key={v.name} style={{ textAlign: "right" }}>
                            <span
                              className={`pricecell ${state} ${isSel ? "selected" : ""} ${isBest ? "best" : ""}`}
                              onClick={() => setSel(isSel ? null : { line: l.id, vendor: v.name })}
                              title={state === "missing" ? "missing / blocked — click for why" : "click for provenance"}
                            >
                              {c?.price != null ? fmt(c.price) : "—"}
                              {c?.converted && c?.price != null ? <span className="glyph">⇄</span> : null}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "qq" && (
            <div className="panelbody">
              <div className="qmatrix">
                <div className="qh">Questionnaire item</div>
                {vendors.map((v) => <div className="qh" key={v.name}>{v.name.split(" ")[0]}</div>)}
                {[...new Set(questionnaire.map((r) => r.item))].map((item) => {
                  const label = questionnaire.find((r) => r.item === item)?.label;
                  return (
                    <>
                      <div key={item}>{label}</div>
                      {vendors.map((v) => {
                        const r = questionnaire.find((x) => x.vendor === v.name && x.item === item);
                        return (
                          <div key={v.name + item} title={`${r?.answer || ""} ${r?.note || ""}`}>
                            <span className={`qs ${r?.status || "missing"}`}>{r?.status || "missing"}</span>
                          </div>
                        );
                      })}
                    </>
                  );
                })}
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="provkey" style={{ marginBottom: 6 }}>Attachments (read & cross-checked against declarations)</div>
                {attachments.map((a, i) => (
                  <div key={i} style={{ fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                    <span className="mono" style={{ fontSize: 11 }}>{a.filename}</span> — {a.kind} ({a.vendor})
                    {a.valid_until ? <span className="mono" style={{ fontSize: 11 }}> · valid until {a.valid_until}</span> : null}
                    {a.flag ? <div style={{ color: "var(--danger)", fontSize: 12 }}>⚠ {a.flag}</div> : <span style={{ color: "var(--verified)" }}> ✓</span>}
                  </div>
                ))}
                <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--faint)" }}>
                  Terms extracted: {terms.length} across vendors — conditional discounts are modeled as scenarios, never blended into unit prices.
                </div>
              </div>
            </div>
          )}

          {tab === "exc" && (
            <div className="panelbody">
              {exceptions.length === 0 && <div style={{ color: "var(--faint)" }}>No exceptions.</div>}
              {exceptions.map((e) => {
                const detail = JSON.parse(e.detail || "{}");
                const row = e.vendor === "Shree Balaji Packers"
                  ? (detail.anchor?.match?.(/row\s*(\d+)/i)?.[1] || (e.line_id && cellMap[`${e.line_id}|${e.vendor}`]?.anchor && (JSON.parse(cellMap[`${e.line_id}|${e.vendor}`].anchor).ref || "").match(/row\s*(\d+)/i)?.[1]))
                  : null;
                return (
                  <div className={`exccard ${e.status !== "open" ? "resolved" : ""}`} key={e.id}>
                    <div className="mono" style={{ fontSize: 10, color: "var(--faint)", marginBottom: 4 }}>
                      #{e.id} · {e.vendor}{e.line_id ? ` · ${e.line_id}` : ""} · {e.kind} · {e.status}{e.resolution ? ` — ${e.resolution}` : ""}
                    </div>
                    <div className="exctitle">{e.title}</div>
                    {row ? <img className="cropimg" src={`/api/crop?row=${row}`} alt="source region" /> : null}
                    {e.status === "open" && (
                      <div className="excactions" style={{ marginTop: 8 }}>
                        {(detail.readings || []).map((r) => (
                          <button className="btn" key={r} onClick={() => resolve(e.id, "confirm", r)}>Confirm ₹{r}</button>
                        ))}
                        <button className="btn primary" onClick={() => { setModal({ title: `Ask ${e.vendor}`, body: askEmailDraft(e, vendors) }); resolve(e.id, "ask"); }}>
                          Ask vendor
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {sel && selCell && (
          <div className="panelcard">
            <div className="panelhead">Provenance — {sel.line} × {sel.vendor}
              <span className={`chip ${selCell.state === "verified" ? "v" : selCell.state === "inferred" ? "i" : "m"}`} style={{ marginLeft: 8 }}>
                {selCell.price != null ? `${selCell.state.toUpperCase()} · ₹${fmt(selCell.price)}/pc landed` : "MISSING / BLOCKED"}
              </span>
              <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setSel(null)}>close</button>
            </div>
            <div className="provenance" style={{ borderTop: "none" }}>
              <div className="provkey">Source</div>
              <div className="anchorquote">{JSON.parse(selCell.anchor || "{}").ref || "no source — line not covered by this response"}</div>
              {photoRow ? <img className="cropimg" src={`/api/crop?row=${photoRow}`} alt="source row from the photographed rate card" /> : null}
              <div className="provkey" style={{ marginTop: 10 }}>Normalization trail</div>
              {JSON.parse(selCell.trail || "[]").map((t, i) => <div className="trailstep" key={i}>{t}</div>)}
              {JSON.parse(selCell.assumptions || "[]").length > 0 && (
                <>
                  <div className="provkey" style={{ marginTop: 10 }}>Assumptions on this cell</div>
                  {JSON.parse(selCell.assumptions).map((a, i) => (
                    <div className="trailstep" key={i} style={{ borderLeftColor: "var(--inferred)" }}>{a.kind}: {a.detail}</div>
                  ))}
                </>
              )}
              <div className="provkey" style={{ marginTop: 10 }}>Extraction agreement</div>
              <div className="trailstep">pass A read: {selCell.pass_a ?? "—"} · pass B read: {selCell.pass_b ?? "—"} {selCell.pass_a != null && selCell.pass_b != null ? "· agreed" : ""}</div>
              {selLine && <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--faint)" }}>Line spec: {selLine.description} · {selLine.dims}mm · {selLine.ply}-ply · computed weight {selLine.weight_kg} kg ±{selLine.weight_band_pct}% · plant {selLine.plant}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="side">
        <div className="chathead">
          <div className="t">Analyst</div>
          <div className="s">Plain language over the whole comparison. Every number comes from a query you can open; mode: <b>{strict ? "strict" : "default"}</b>.</div>
        </div>
        <div className="chat">
          {chat.length === 0 && (
            <div style={{ color: "var(--faint)", fontSize: 12.5 }}>
              Ask anything — splits, what-ifs, “why is this cell amber”, coverage risk, the award memo. Nothing is precomputed: the agent writes SQL against the extracted store, live.
            </div>
          )}
          {chat.map((m, i) =>
            m.role === "q" ? (
              <div className="q" key={i}>{m.text}</div>
            ) : (
              <div className="a" key={i}>
                {m.answer?.constraints_text ? <div className="constraints">⚖ {m.answer.constraints_text}</div> : null}
                <Md text={m.answer?.answer_md} />
                {m.answer?.figures?.length ? (
                  <div className="figrow">
                    {m.answer.figures.map((f, j) => (
                      <div className="fig" key={j}><div className="l">{f.label}</div><div className="v">{f.value}</div></div>
                    ))}
                  </div>
                ) : null}
                {m.answer?.table?.rows?.length ? (
                  <div className="atable">
                    <table>
                      <thead><tr>{m.answer.table.columns.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
                      <tbody>
                        {m.answer.table.rows.map((r, j) => (
                          <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {m.answer?.chart?.bars?.length ? (
                  <div className="chart">
                    <div className="provkey">{m.answer.chart.title}</div>
                    {(() => {
                      const max = Math.max(...m.answer.chart.bars.map((b) => b.value));
                      return m.answer.chart.bars.map((b, j) => (
                        <div className="bar" key={j}>
                          <span>{b.label}</span>
                          <div className="track"><div className="fill" style={{ width: `${(b.value / max) * 100}%` }} /></div>
                          <span className="val">{b.value >= 100000 ? lakh(b.value) : b.value.toLocaleString("en-IN")}</span>
                        </div>
                      ));
                    })()}
                  </div>
                ) : null}
                {m.receipts?.length ? (
                  <details className="receipts">
                    <summary>receipts — {m.receipts.length} quer{m.receipts.length === 1 ? "y" : "ies"} on the store</summary>
                    {m.receipts.map((r, j) => (
                      <div key={j}>
                        <div className="sqlblock">{r.sql}</div>
                        <div className="rowcount">{r.error ? `error: ${r.error}` : `${r.row_count} rows`}</div>
                      </div>
                    ))}
                  </details>
                ) : null}
              </div>
            ),
          )}
          {busy && <div className="thinking"><span className="spinner" />writing queries against the quote store…</div>}
          <div ref={chatEndRef} />
        </div>
        <div className="suggest">
          {suggestions.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}>{s.length > 46 ? s.slice(0, 44) + "…" : s}</button>
          ))}
        </div>
        <form className="askbar" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the comparison anything…" disabled={busy} />
          <button className="btn primary" disabled={busy || !q.trim()}>Ask</button>
        </form>
      </div>

      {modal && (
        <div className="modal" onClick={() => setModal(null)}>
          <div className="modalbox" onClick={(e) => e.stopPropagation()}>
            <div className="panelhead" style={{ border: "none", paddingLeft: 0 }}>{modal.title}
              <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setModal(null)}>close</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--faint)" }}>Drafted deterministically from the store — SMTP is stubbed in this prototype; nothing is actually sent.</div>
            <div className="emaildraft">{modal.body}</div>
          </div>
        </div>
      )}
    </div>
  );
}
