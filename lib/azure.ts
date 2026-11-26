// Thin client for the public Azure Retail Prices API with caching, paging and 429 retry.
export const PRICES_API = "https://prices.azure.com/api/retail/prices";
const API_VERSION = "2023-01-01-preview"; // includes savingsPlan arrays on consumption items

export interface PriceItem {
  currencyCode: string;
  retailPrice: number;
  unitPrice: number;
  armRegionName: string;
  armSkuName: string;
  productName: string;
  skuName: string;
  meterName: string;
  serviceName: string;
  unitOfMeasure: string;
  type: string; // Consumption | Reservation | DevTestConsumption
  reservationTerm?: string;
  savingsPlan?: { unitPrice: number; retailPrice: number; term: string }[];
}

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; p: Promise<PriceItem[]> }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-HTTP-call timeout. The Retail Prices API normally answers in 1-2 s; never let one call hang a function. */
export const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 4_000;
/** Max concurrent outbound calls per instance, to stay under the Retail Prices API throttle. */
const MAX_CONCURRENT = 4;

let active = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

const retryable = (e: any) => e?.name === "TimeoutError" || e?.name === "AbortError" || e instanceof TypeError;

async function getJson(url: string, attempt = 0): Promise<any> {
  let res: Response;
  try {
    res = await withSlot(() =>
      fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), next: { revalidate: 21600 } } as RequestInit));
  } catch (e: any) {
    if (!retryable(e) || attempt >= MAX_RETRIES) {
      throw new Error(e?.name === "TimeoutError" ? `Azure prices API timed out after ${FETCH_TIMEOUT_MS / 1000}s` : `Azure prices API request failed: ${e?.message ?? e}`);
    }
    await sleep(Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) + Math.random() * 250);
    return getJson(url, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= MAX_RETRIES) throw new Error(`Azure prices API ${res.status}${res.status === 429 ? " (rate limited)" : ""} after ${MAX_RETRIES} retries`);
    const ra = Number(res.headers.get("retry-after"));
    // Cap Retry-After so a long throttle hint cannot push the request past the function time limit.
    await sleep(Math.min(MAX_BACKOFF_MS, ra > 0 ? ra * 1000 : 500 * 2 ** attempt) + Math.random() * 250);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Azure prices API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Query with an OData filter, following NextPageLink. Results are cached and in-flight requests deduped. */
export function queryPrices(filter: string, currency = "GBP", maxPages = 10): Promise<PriceItem[]> {
  const key = `${currency}|${filter}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = (async () => {
    const u = new URL(PRICES_API);
    u.searchParams.set("api-version", API_VERSION);
    u.searchParams.set("currencyCode", currency);
    u.searchParams.set("$filter", filter);
    let url: string | null = u.toString();
    const out: PriceItem[] = [];
    for (let i = 0; url && i < maxPages; i++) {
      const d: any = await getJson(url);
      out.push(...(d.Items ?? []));
      url = d.NextPageLink ?? null;
    }
    return out;
  })();
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

export const esc = (s: string) => s.replace(/'/g, "''");
