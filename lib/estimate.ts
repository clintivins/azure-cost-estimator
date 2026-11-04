import {
  getVmRates, getAksFees, aksTierPerHour, getDiskMonthly, getOther, isKnownRegion,
  VmRates, PricingOption, PRICING_OPTIONS,
} from "./pricing";

export interface InputRow {
  name?: string; service?: string; arm_sku?: string; region?: string; quantity?: number | string;
  hours_per_month?: number | string; os?: string; pricing?: string; ahb?: string | boolean; aks_tier?: string;
}
export type Status = "OK" | "WARN" | "ERROR";
export interface ResultRow {
  name: string; service: string; arm_sku: string; region: string; quantity: number; hours_per_month: number;
  os: string; pricing: string; status: Status; message: string;
  payg_month: number | null; spot_month: number | null; ri1y_month: number | null; ri3y_month: number | null;
  sp1y_month: number | null; sp3y_month: number | null; chosen_option: string;
  chosen_month: number | null; chosen_year: number | null; saving_vs_payg_pct: number | null;
}
export interface Totals { payg_month: number; chosen_month: number; chosen_year: number; saving_vs_payg_pct: number }

const r2 = (n: number | null | undefined) => (n == null || !isFinite(n) ? null : Math.round(n * 100) / 100);
const yes = (v: unknown) => /^(y|yes|true|1)$/i.test(String(v ?? "").trim());
const num = (v: unknown, d: number) => { const n = Number(v); return v === "" || v == null || !isFinite(n) ? d : n; };

export interface Options { payg?: number; spot?: number; ri1y?: number; ri3y?: number; sp1y?: number; sp3y?: number }

/** Pure calc: monthly cost of each purchase option for qty VMs running `hours` per month. */
export function vmOptions(r: VmRates, qty: number, hours: number, windows: boolean): Options {
  const lic = windows && r.windowsPayg != null && r.linuxPayg != null ? Math.max(0, r.windowsPayg - r.linuxPayg) : 0;
  const lp = r.linuxPayg;
  const o: Options = {};
  const payg = windows ? r.windowsPayg : lp;
  if (payg != null) o.payg = payg * hours * qty;
  const spot = windows ? r.windowsSpot : r.linuxSpot;
  if (spot != null) o.spot = spot * hours * qty;
  if (r.ri1y != null) o.ri1y = (r.ri1y / 12 + lic * hours) * qty;
  if (r.ri3y != null) o.ri3y = (r.ri3y / 36 + lic * hours) * qty;
  if (r.sp1y != null) o.sp1y = (r.sp1y + lic) * hours * qty;
  if (r.sp3y != null) o.sp3y = (r.sp3y + lic) * hours * qty;
  return o;
}

const KEY: Record<PricingOption, keyof Options> = { PAYG: "payg", Spot: "spot", RI1Y: "ri1y", RI3Y: "ri3y", SP1Y: "sp1y", SP3Y: "sp3y" };

export function normPricing(p?: string): PricingOption | undefined {
  const s = String(p ?? "PAYG").trim().toUpperCase().replace(/[\s_-]/g, "");
  return PRICING_OPTIONS.find((o) => o.toUpperCase() === s);
}

export function finalise(base: Omit<ResultRow, "payg_month"|"spot_month"|"ri1y_month"|"ri3y_month"|"sp1y_month"|"sp3y_month"|"chosen_option"|"chosen_month"|"chosen_year"|"saving_vs_payg_pct">,
  o: Options, choice: PricingOption, discountPct: number, extraMonthly = 0): ResultRow {
  const f = 1 - discountPct / 100;
  const adj = (v?: number) => (v == null ? null : (v + extraMonthly) * f);
  let status = base.status, message = base.message, chosen = choice;
  if (o[KEY[choice]] == null) {
    if (o.payg == null) return { ...base, status: "ERROR", message: message || "No price found", payg_month: null, spot_month: null, ri1y_month: null, ri3y_month: null, sp1y_month: null, sp3y_month: null, chosen_option: choice, chosen_month: null, chosen_year: null, saving_vs_payg_pct: null };
    status = status === "ERROR" ? status : "WARN";
    message = [message, `${choice} not offered for this SKU/region; fell back to PAYG`].filter(Boolean).join("; ");
    chosen = "PAYG";
  }
  const payg = adj(o.payg), cm = adj(o[KEY[chosen]]);
  return {
    ...base, status, message,
    payg_month: r2(payg), spot_month: r2(adj(o.spot)), ri1y_month: r2(adj(o.ri1y)), ri3y_month: r2(adj(o.ri3y)),
    sp1y_month: r2(adj(o.sp1y)), sp3y_month: r2(adj(o.sp3y)), chosen_option: chosen,
    chosen_month: r2(cm), chosen_year: r2(cm == null ? null : cm * 12),
    saving_vs_payg_pct: payg && cm != null ? r2((1 - cm / payg) * 100) : null,
  };
}

export async function estimateRow(row: InputRow, currency = "GBP", discountPct = 0): Promise<ResultRow> {
  const service = String(row.service ?? "").trim();
  const svc = (["VM", "AKS", "Disk", "Other"].find((s) => s.toLowerCase() === service.toLowerCase()) ?? service) as string;
  const sku = String(row.arm_sku ?? "").trim();
  const region = String(row.region ?? "").trim().toLowerCase().replace(/\s/g, "");
  const qty = num(row.quantity, 1);
  const hours = num(row.hours_per_month, 730);
  const os = /^win/i.test(String(row.os ?? "")) ? "Windows" : "Linux";
  const ahb = yes(row.ahb);
  const choice = normPricing(row.pricing);
  const base = { name: String(row.name ?? ""), service: svc, arm_sku: sku, region, quantity: qty, hours_per_month: hours, os, pricing: String(row.pricing ?? "PAYG"), status: "OK" as Status, message: "" };
  const err = (m: string) => finalise({ ...base, status: "ERROR", message: m }, {}, "PAYG", 0);

  const missing = [!svc && "service", !sku && "arm_sku", !region && "region"].filter(Boolean);
  if (missing.length) return err(`Missing field(s): ${missing.join(", ")}`);
  if (!["VM", "AKS", "Disk", "Other"].includes(svc)) return err(`Unknown service '${service}' (use VM, AKS, Disk or Other)`);
  if (!choice) return err(`Unknown pricing '${row.pricing}' (use ${PRICING_OPTIONS.join("/")})`);
  if (qty <= 0 || hours < 0 || hours > 744) return err("quantity must be > 0 and hours_per_month 0-744");

  try {
    if (!(await isKnownRegion(region))) return err(`Unknown region '${region}'`);
    if (svc === "VM" || svc === "AKS") {
      const rates = await getVmRates(sku, region, currency);
      if (rates.linuxPayg == null && rates.windowsPayg == null) return err(`SKU '${sku}' not found in ${region}`);
      const windows = os === "Windows" && !ahb && svc === "VM";
      const o = vmOptions(rates, qty, hours, windows);
      let extra = 0, msg = ahb && os === "Windows" ? "Azure Hybrid Benefit: Linux compute meter used" : "";
      if (svc === "AKS") {
        const tier = String(row.aks_tier ?? "Free").trim() || "Free";
        const fee = aksTierPerHour(tier, await getAksFees(region, currency));
        if (fee == null) return err(`AKS tier '${tier}' not priced in ${region} (use Free/Standard/Premium)`);
        extra = fee * hours;
        msg = `${qty} node(s) + ${tier} tier fee ${r2(extra)}/month`;
      }
      return finalise({ ...base, message: msg }, o, choice, discountPct, extra);
    }
    if (svc === "Disk") {
      const d = await getDiskMonthly(sku, region, currency);
      if (!d) return err(`Disk SKU '${sku}' not found in ${region}`);
      const o = { payg: d.retailPrice * qty };
      return finalise({ ...base, message: `${d.productName} ${d.skuName}` }, o, choice === "PAYG" ? "PAYG" : choice, discountPct);
    }
    const it = await getOther(sku, region, currency);
    if (!it) return err(`SKU '${sku}' not found in ${region}`);
    const perHour = /hour/i.test(it.unitOfMeasure);
    const o = { payg: it.retailPrice * qty * (perHour ? hours : 1) };
    return finalise({ ...base, status: "WARN", message: `Generic match: ${it.serviceName} / ${it.meterName} (${it.unitOfMeasure}) - verify` }, o, choice, discountPct);
  } catch (e: any) {
    return err(`Pricing lookup failed: ${e?.message ?? e}`);
  }
}

/** Estimate many rows with bounded concurrency; identical lookups are deduped by the cache. */
export async function estimateRows(rows: InputRow[], currency = "GBP", discountPct = 0, concurrency = 6) {
  const out: ResultRow[] = new Array(rows.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (idx < rows.length) { const i = idx++; out[i] = await estimateRow(rows[i], currency, discountPct); }
  }));
  const sum = (k: keyof ResultRow) => r2(out.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0)) ?? 0;
  const payg = out.reduce((a, r) => a + (r.chosen_month != null ? r.payg_month ?? 0 : 0), 0);
  const cm = sum("chosen_month");
  const totals: Totals = { payg_month: r2(payg) ?? 0, chosen_month: cm, chosen_year: r2(cm * 12) ?? 0, saving_vs_payg_pct: payg ? r2((1 - cm / payg) * 100) ?? 0 : 0 };
  return { currency, discount_pct: discountPct, rows: out, totals };
}
