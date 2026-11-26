import { estimateRows, InputRow } from "@/lib/estimate";

// Hobby allows up to 60 s. estimateRows returns by its own 45 s deadline so we always answer with JSON.
export const maxDuration = 60;
const MAX_ROWS = 500;
const DEADLINE_MS = 45_000;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  try {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Request body is not valid JSON" }, 400); }
    const rows: InputRow[] = Array.isArray(body) ? body : body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return json({ error: "Body must be {rows:[...], currency?, discount_pct?}" }, 400);
    if (rows.length > MAX_ROWS) return json({ error: `Max ${MAX_ROWS} rows per request` }, 413);
    const currency = String(body?.currency ?? "GBP").toUpperCase();
    if (!["GBP", "USD", "EUR"].includes(currency)) return json({ error: "currency must be GBP, USD or EUR" }, 400);
    const discount = Math.min(100, Math.max(0, Number(body?.discount_pct ?? 0) || 0));
    return json(await estimateRows(rows, currency, discount, 6, DEADLINE_MS));
  } catch (e: any) {
    console.error("estimate failed", e);
    return json({ error: `Estimate failed: ${e?.message ?? String(e)}` }, 500);
  }
}
