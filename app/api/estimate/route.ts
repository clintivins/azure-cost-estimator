import { estimateRows, InputRow } from "@/lib/estimate";
export const maxDuration = 60;
const MAX_ROWS = 500;
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const rows: InputRow[] = Array.isArray(body) ? body : body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return Response.json({ error: "Body must be {rows:[...], currency?, discount_pct?}" }, { status: 400 });
  if (rows.length > MAX_ROWS) return Response.json({ error: `Max ${MAX_ROWS} rows per request` }, { status: 413 });
  const currency = String(body.currency ?? "GBP").toUpperCase();
  if (!["GBP", "USD", "EUR"].includes(currency)) return Response.json({ error: "currency must be GBP, USD or EUR" }, { status: 400 });
  const discount = Math.min(100, Math.max(0, Number(body.discount_pct ?? 0) || 0));
  const result = await estimateRows(rows, currency, discount);
  return Response.json(result, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
