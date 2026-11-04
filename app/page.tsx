"use client";
import { useState, useCallback } from "react";
import * as XLSX from "xlsx";

type Row = Record<string, any>;
const COLS: [string, string][] = [
  ["payg_month", "PAYG /mo"], ["spot_month", "Spot /mo"], ["ri1y_month", "RI 1Y /mo"], ["ri3y_month", "RI 3Y /mo"],
  ["sp1y_month", "SP 1Y /mo"], ["sp3y_month", "SP 3Y /mo"], ["chosen_month", "Chosen /mo"], ["chosen_year", "Chosen /yr"],
];

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [file, setFile] = useState("");
  const [discount, setDiscount] = useState(0);
  const [currency, setCurrency] = useState("GBP");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);

  const load = useCallback(async (f: File) => {
    setErr(""); setResult(null);
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: "" }).map((r) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, "_"), v])))
        .filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!data.length) throw new Error("No rows found in first sheet");
      setRows(data); setFile(f.name);
    } catch (e: any) { setErr(e.message); }
  }, []);

  const run = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows, currency, discount_pct: discount }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setResult(j);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.rows), "Estimate");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ currency: result.currency, discount_pct: result.discount_pct, ...result.totals }]), "Totals");
    XLSX.writeFile(wb, "azure-estimate.xlsx");
  };
  const fmt = (v: any) => (v == null ? "–" : new Intl.NumberFormat("en-GB", { style: "currency", currency: result?.currency ?? currency }).format(v));

  return (
    <main>
      <h1>Azure Cost Estimator</h1>
      <p className="sub">Upload a bill of materials (.xlsx / .csv). Prices come live from the public Azure Retail Prices API. Estimates only — excludes tax, egress, support and negotiated rates beyond the discount you enter.</p>
      <div className="card">
        <div className={`drop ${over ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}
          onClick={() => document.getElementById("f")?.click()}>
          {file ? <b>{file} — {rows.length} row(s)</b> : "Drag & drop a spreadsheet here, or click to choose"}
          <input id="f" type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn sec" href="/template.xlsx">Download template</a>
          <a className="btn sec" href="/sample.xlsx">Download sample</a>
          <label>Discount % <input type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 80 }} /></label>
          <label>Currency <select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>GBP</option><option>USD</option><option>EUR</option></select></label>
          <button onClick={run} disabled={!rows.length || busy}>{busy ? "Pricing…" : "Estimate"}</button>
          {result && <button className="sec" onClick={exportXlsx}>Export .xlsx</button>}
        </div>
        {err && <p className="err">{err}</p>}
      </div>
      {result && (
        <div className="card scroll">
          <table>
            <thead><tr><th className="l">Status</th><th className="l">Name</th><th className="l">Service</th><th className="l">SKU</th><th className="l">Region</th><th>Qty</th><th className="l">Pricing</th>
              {COLS.map(([, h]) => <th key={h}>{h}</th>)}<th>Saving vs PAYG</th><th className="l">Message</th></tr></thead>
            <tbody>{result.rows.map((r: Row, i: number) => (
              <tr key={i}><td className="l"><span className={`s ${r.status}`}>{r.status}</span></td><td className="l">{r.name}</td><td className="l">{r.service}</td><td className="l">{r.arm_sku}</td><td className="l">{r.region}</td><td>{r.quantity}</td><td className="l">{r.chosen_option}</td>
                {COLS.map(([k]) => <td key={k}>{fmt(r[k])}</td>)}<td>{r.saving_vs_payg_pct == null ? "–" : `${r.saving_vs_payg_pct}%`}</td><td className="msg">{r.message}</td></tr>))}
            </tbody>
            <tfoot><tr><td className="l" colSpan={7}>Totals ({result.currency}{result.discount_pct ? `, ${result.discount_pct}% discount` : ""})</td>
              <td>{fmt(result.totals.payg_month)}</td><td colSpan={5}></td><td>{fmt(result.totals.chosen_month)}</td><td>{fmt(result.totals.chosen_year)}</td><td>{result.totals.saving_vs_payg_pct}%</td><td></td></tr></tfoot>
          </table>
        </div>
      )}
      <p className="sub">MCP server: <code>/api/mcp</code> (Streamable HTTP). Tools: price_sku, estimate_aks, estimate_bom.</p>
    </main>
  );
}
