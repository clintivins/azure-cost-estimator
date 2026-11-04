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

async function getJson(url: string, attempt = 0): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 21600 } } as RequestInit);
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`Azure prices API ${res.status} after retries`);
    const ra = Number(res.headers.get("retry-after"));
    await sleep(ra > 0 ? ra * 1000 : 500 * 2 ** attempt + Math.random() * 250);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Azure prices API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Query with an OData filter, following NextPageLink. Results are cached and in-flight requests deduped. */
export function queryPrices(filter: string, currency = "GBP", maxPages = 20): Promise<PriceItem[]> {
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
