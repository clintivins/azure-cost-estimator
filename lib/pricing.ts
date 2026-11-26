import { queryPrices, esc, PriceItem } from "./azure";

export type Service = "VM" | "AKS" | "Disk" | "Other";
export type PricingOption = "PAYG" | "RI1Y" | "RI3Y" | "SP1Y" | "SP3Y" | "Spot";
export const PRICING_OPTIONS: PricingOption[] = ["PAYG", "RI1Y", "RI3Y", "SP1Y", "SP3Y", "Spot"];
export const CURRENCIES = ["GBP", "USD", "EUR"] as const;

export interface VmRates {
  sku: string;
  region: string;
  currency: string;
  linuxPayg?: number; // per hour
  windowsPayg?: number;
  linuxSpot?: number;
  windowsSpot?: number;
  ri1y?: number; // total reservation price for the term (compute only)
  ri3y?: number;
  sp1y?: number; // per hour (compute only)
  sp3y?: number;
}

/** Pure meter selection from raw API items for one VM SKU. */
export function selectVmMeters(items: PriceItem[], sku: string, region: string, currency: string): VmRates {
  const r: VmRates = { sku, region, currency };
  for (const i of items) {
    if (i.armSkuName?.toLowerCase() !== sku.toLowerCase()) continue;
    const name = `${i.meterName} ${i.skuName}`;
    if (/low priority/i.test(name)) continue;
    if (/cloud services/i.test(i.productName)) continue;
    const win = /windows/i.test(i.productName);
    const spot = /spot/i.test(i.meterName);
    if (i.type === "Consumption") {
      if (spot) win ? (r.windowsSpot = i.retailPrice) : (r.linuxSpot = i.retailPrice);
      else if (win) r.windowsPayg = i.retailPrice;
      else {
        r.linuxPayg = i.retailPrice;
        for (const sp of i.savingsPlan ?? []) {
          if (/^1/.test(sp.term)) r.sp1y = sp.retailPrice;
          if (/^3/.test(sp.term)) r.sp3y = sp.retailPrice;
        }
      }
    } else if (i.type === "Reservation" && !win && !spot) {
      if (/^1/.test(i.reservationTerm ?? "")) r.ri1y = i.retailPrice;
      if (/^3/.test(i.reservationTerm ?? "")) r.ri3y = i.retailPrice;
    }
  }
  return r;
}

export async function getVmRates(sku: string, region: string, currency = "GBP"): Promise<VmRates> {
  const items = await queryPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${esc(region.toLowerCase())}' and armSkuName eq '${esc(sku)}'`,
    currency,
  );
  return selectVmMeters(items, sku, region, currency);
}

const regionCache = new Map<string, Promise<boolean>>();
export function isKnownRegion(region: string): Promise<boolean> {
  const k = region.toLowerCase();
  if (!regionCache.has(k)) {
    regionCache.set(
      k,
      queryPrices(`armRegionName eq '${esc(k)}' and serviceName eq 'Virtual Machines'`, "USD", 1).then((x) => x.length > 0),
    );
  }
  return regionCache.get(k)!;
}

export interface AksFees { standardPerHour?: number; ltsPerHour?: number }
export function selectAksMeters(items: PriceItem[]): AksFees {
  const f: AksFees = {};
  for (const i of items) {
    if (i.type !== "Consumption" || i.productName !== "Azure Kubernetes Service") continue;
    if (i.meterName === "Standard Uptime SLA") f.standardPerHour = i.retailPrice;
    if (i.meterName === "Standard Long Term Support") f.ltsPerHour = i.retailPrice;
  }
  return f;
}
export async function getAksFees(region: string, currency = "GBP"): Promise<AksFees> {
  const items = await queryPrices(
    `serviceName eq 'Azure Kubernetes Service' and armRegionName eq '${esc(region.toLowerCase())}'`,
    currency,
  );
  return selectAksMeters(items);
}
/** Cluster management fee per hour: Free=0, Standard=Uptime SLA, Premium=Uptime SLA + Long Term Support. */
export function aksTierPerHour(tier: string, f: AksFees): number | undefined {
  const t = tier.toLowerCase();
  if (t === "free") return 0;
  if (t === "standard") return f.standardPerHour;
  if (t === "premium") return f.standardPerHour != null && f.ltsPerHour != null ? f.standardPerHour + f.ltsPerHour : undefined;
  return undefined;
}

export function normaliseDiskSku(sku: string): string {
  const s = sku.trim().replace(/_/g, " ");
  return /\s(LRS|ZRS)$/i.test(s) ? s.replace(/\s(lrs|zrs)$/i, (m) => m.toUpperCase()) : `${s} LRS`;
}
export function selectDiskMeter(items: PriceItem[]): PriceItem | undefined {
  return items.find(
    (i) => i.type === "Consumption" && /Managed Disks/i.test(i.productName) && / Disk$/.test(i.meterName) && i.unitOfMeasure === "1/Month",
  );
}
export async function getDiskMonthly(sku: string, region: string, currency = "GBP"): Promise<PriceItem | undefined> {
  const items = await queryPrices(
    `serviceName eq 'Storage' and armRegionName eq '${esc(region.toLowerCase())}' and skuName eq '${esc(normaliseDiskSku(sku))}'`,
    currency,
  );
  return selectDiskMeter(items);
}

/** Score a candidate meter for a generic ("Other") lookup: prefer billable capacity meters over add-ons. */
export function scoreOtherMeter(i: PriceItem, meter?: string, serviceName?: string): number {
  if (i.type !== "Consumption" || /low priority|spot/i.test(i.meterName)) return -Infinity;
  if (meter && !i.meterName.toLowerCase().includes(meter.toLowerCase())) return -Infinity;
  let s = 0;
  if (i.retailPrice > 0) s += 4;
  if (/hour|month/i.test(i.unitOfMeasure)) s += 2;
  if (/\b(unit|instance|vcore|node|messaging unit)\b/i.test(i.meterName)) s += 1;
  if (serviceName && i.productName?.toLowerCase() === serviceName.toLowerCase()) s += 3;
  if (/secondary|self-hosted|workspace|overage|backup|snapshot|data processed|software|renewal|rotation/i.test(i.meterName)) s -= 3;
  return s;
}
/** Highest score wins; ties go to the cheaper meter so an ambiguous match never inflates the estimate. */
export function selectOtherMeter(items: PriceItem[], meter?: string, serviceName?: string): PriceItem | undefined {
  let best: PriceItem | undefined, bestScore = -Infinity;
  for (const i of items) {
    const sc = scoreOtherMeter(i, meter, serviceName);
    if (sc === -Infinity) continue;
    if (sc > bestScore || (sc === bestScore && best && i.retailPrice < best.retailPrice)) { best = i; bestScore = sc; }
  }
  return best;
}

export interface OtherMatch { item?: PriceItem; services: string[] }

/** Best-effort lookup for any other service. serviceName (e.g. "API Management") and meter narrow the match. */
export async function getOther(sku: string, region: string, currency = "GBP", serviceName?: string, meter?: string): Promise<OtherMatch> {
  const svc = serviceName ? ` and serviceName eq '${esc(serviceName)}'` : "";
  const items = await queryPrices(
    `armRegionName eq '${esc(region.toLowerCase())}'${svc} and (armSkuName eq '${esc(sku)}' or skuName eq '${esc(sku)}')`,
    currency,
  );
  const usable = items.filter((i) => scoreOtherMeter(i, meter, serviceName) > -Infinity);
  const services = [...new Set(usable.map((i) => i.serviceName))].sort();
  // Without a service name a bare SKU such as "Standard" matches many unrelated services; refuse to guess.
  if (!serviceName && services.length > 1) return { services };
  return { item: selectOtherMeter(usable, meter, serviceName), services };
}
