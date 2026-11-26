import {
  getVmRates, getAksFees, aksTierPerHour, getDiskMonthly, getOther, isKnownRegion,
  VmRates, PricingOption, PRICING_OPTIONS,
} from "./pricing";
import { priceCatalogue, resolve, ComponentResult } from "./catalogue";

export interface InputRow {
  name?: string; service?: string; arm_sku?: string; region?: string; quantity?: number | string;
  hours_per_month?: number | string; os?: string; pricing?: string; ahb?: string | boolean; aks_tier?: string;
  /** Optional Azure serviceName for Other rows, e.g. "API Management", "Service Bus". */
  service_name?: string;
  /** Optional meter-name substring for Other rows, e.g. "Unit", "Messaging Unit". Forces the generic lookup. */
  meter?: string;
  /** Usage drivers for service-aware pricing (gb_stored, write_10k, read_10k, gb_processed, queries_million, gb_ingested, ...). */
  [usage: string]: unknown;
}
export type Status = "OK" | "WARN" | "INFO" | "ERROR";
export interface ResultRow {
  name: string; service: string; arm_sku: string; region: string; quantity: number; hours_per_month: number | null;
  os: string; pricing: string; status: Status; message: string;
  payg_month: number | null; spot_month: number | null; ri1y_month: number | null; ri3y_month: number | null;
  sp1y_month: number | null; sp3y_month: number | null; chosen_option: string;
  chosen_month: number | null; chosen_year: number | null; saving_vs_payg_pct: number | null;
  /** Retail meter(s) used, "; "-separated. */
  matched_meters: string;
  /** Unit price of the primary meter (first billable tier), in the response currency, before discount. */
  unit_price: number | null;
  /** Billable quantity per meter, e.g. "730 x 1 Hour; 100 x 1 GB/Month". */
  usage: string;
  /** Usage values used, with defaults called out. */
  assumptions: string;
  components?: ComponentResult[];
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

type Extra = "matched_meters" | "unit_price" | "usage" | "assumptions";
export function finalise(b: Omit<ResultRow, "payg_month"|"spot_month"|"ri1y_month"|"ri3y_month"|"sp1y_month"|"sp3y_month"|"chosen_option"|"chosen_month"|"chosen_year"|"saving_vs_payg_pct"|Extra> & Partial<Pick<ResultRow, Extra>>,
  o: Options, choice: PricingOption, discountPct: number, extraMonthly = 0): ResultRow {
  const base = { matched_meters: "", unit_price: null, usage: "", assumptions: "", ...b };
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

export async function estimateRow(input: InputRow, currency = "GBP", discountPct = 0): Promise<ResultRow> {
  const row: InputRow = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const service = String(row.service ?? "").trim();
  const known = ["VM", "AKS", "Disk", "Other"].find((s) => s.toLowerCase() === service.toLowerCase());
  // Anything that is not VM/AKS/Disk is priced as Other; a full Azure service name (e.g. "API Management") narrows the lookup.
  const svc = known ?? (service ? "Other" : "");
  const serviceName = String(row.service_name ?? "").trim() || (known ? "" : service);
  const meter = String(row.meter ?? "").trim() || undefined;
  const sku = String(row.arm_sku ?? "").trim();
  const region = String(row.region ?? "").trim().toLowerCase().replace(/\s/g, "");
  const qty = num(row.quantity, 1);
  const hours = num(row.hours_per_month, 730);
  const os = /^win/i.test(String(row.os ?? "")) ? "Windows" : "Linux";
  const ahb = yes(row.ahb);
  const choice = normPricing(row.pricing);
  const base = { name: String(row.name ?? ""), service: known ?? service, arm_sku: sku, region, quantity: qty, hours_per_month: hours, os, pricing: String(row.pricing ?? "PAYG"), status: "OK" as Status, message: "" };
  const err = (m: string) => finalise({ ...base, status: "ERROR", message: m }, {}, "PAYG", 0);

  // Service-aware catalogue (APIM, Storage, Private Endpoint, DNS, Log Analytics, ...). An explicit `meter` forces the generic lookup.
  if ((svc === "Other" || !svc) && !meter && resolve(row).entry) {
    if (!choice) return err(`Unknown pricing '${row.pricing}' (use ${PRICING_OPTIONS.join("/")})`);
    if (qty <= 0 || hours < 0 || hours > 744) return err("quantity must be > 0 and hours_per_month 0-744");
    const ent = resolve(row).entry!;
    if (!region && !["managedidentity", "externalid", "privateendpoint"].includes(ent.id)) return err("Missing field(s): region");
    try {
      const c = await priceCatalogue(row as Record<string, unknown>, region || "global", hours, String(row.os ?? ""), currency);
      if (c) return catalogueRow({ ...base, service: c.service, os: row.os ? os : "" }, c, qty, choice, discountPct);
    } catch (e: any) {
      return err(`Pricing lookup failed: ${e?.message ?? e}`);
    }
  }

  const missing = [!svc && "service", !sku && "arm_sku", !region && "region"].filter(Boolean);
  if (missing.length) return err(`Missing field(s): ${missing.join(", ")}`);
  if (!choice) return err(`Unknown pricing '${row.pricing}' (use ${PRICING_OPTIONS.join("/")})`);
  if (qty <= 0 || hours < 0 || hours > 744) return err("quantity must be > 0 and hours_per_month 0-744");

  try {
    // Other services include non-VM regions such as "global", so only VM/AKS/Disk rows are checked against the VM region list.
    if (svc !== "Other" && !(await isKnownRegion(region))) return err(`Unknown region '${region}'`);
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
      const hourly = windows ? rates.windowsPayg : rates.linuxPayg;
      return finalise({
        ...base, message: msg,
        matched_meters: `Virtual Machines / ${sku} / ${windows ? "Windows" : "Linux"} consumption${svc === "AKS" ? " + Azure Kubernetes Service tier fee" : ""}`,
        unit_price: hourly ?? null, usage: `${qty} x ${hours} x 1 Hour`,
        assumptions: `${svc === "AKS" ? "Linux nodes" : os}${ahb ? " with AHB" : ""}; ${hours} h/month`,
      }, o, choice, discountPct, extra);
    }
    if (svc === "Disk") {
      const d = await getDiskMonthly(sku, region, currency);
      if (!d) return err(`Disk SKU '${sku}' not found in ${region}`);
      const o = { payg: d.retailPrice * qty };
      return finalise({ ...base, os: "", hours_per_month: null, message: `${d.productName} ${d.skuName}`,
        matched_meters: `${d.productName} / ${d.skuName} / ${d.meterName}`, unit_price: d.retailPrice, usage: `${qty} x ${d.unitOfMeasure}`, assumptions: "" }, o, choice === "PAYG" ? "PAYG" : choice, discountPct);
    }
    const m = await getOther(sku, region, currency, serviceName || undefined, meter);
    if (!m.item && m.services.length > 1) {
      const list = m.services.slice(0, 6).join(", ") + (m.services.length > 6 ? `, +${m.services.length - 6} more` : "");
      return err(`SKU '${sku}' matches ${m.services.length} services in ${region} (${list}); set service_name, e.g. '${m.services[0]}'`);
    }
    const it = m.item;
    if (!it) return err(`SKU '${sku}'${serviceName ? ` for service '${serviceName}'` : ""}${meter ? ` with meter '${meter}'` : ""} not found in ${region}`);
    const perHour = /hour/i.test(it.unitOfMeasure);
    const o = { payg: it.retailPrice * qty * (perHour ? hours : 1) };
    return finalise({ ...base, status: "WARN", message: `Generic match: ${it.serviceName} / ${it.meterName} (${it.unitOfMeasure}) - verify`,
      matched_meters: `${it.productName} / ${it.skuName} / ${it.meterName}`, unit_price: it.retailPrice,
      usage: `${qty}${perHour ? ` x ${hours}` : ""} x ${it.unitOfMeasure}`, assumptions: "generic best-effort match; usage = quantity" }, o, choice, discountPct);
  } catch (e: any) {
    return err(`Pricing lookup failed: ${e?.message ?? e}`);
  }
}

function catalogueRow(base: Parameters<typeof finalise>[0], c: Awaited<ReturnType<typeof priceCatalogue>> & {}, qty: number, choice: PricingOption, discountPct: number): ResultRow {
  const meters = c.components.map((x) => `${x.product} / ${x.sku} / ${x.meter}`).join("; ");
  const usage = c.components.map((x) => `${x.label}: ${fmtQ(x.quantity)} x ${x.unit} @ ${x.unit_price}${x.tiered ? " (tiered)" : ""}`).join("; ");
  const common = {
    ...base, arm_sku: base.arm_sku || c.sku, hours_per_month: c.components.some((x) => /hour/i.test(x.unit)) ? base.hours_per_month : null, matched_meters: meters, usage: qty !== 1 && usage ? `${qty} x [${usage}]` : usage,
    unit_price: c.components.find((x) => x.unit_price > 0)?.unit_price ?? c.components[0]?.unit_price ?? null,
    assumptions: c.assumptions.join("; "), components: c.components,
  };
  if (c.status === "ERROR") return finalise({ ...common, status: "ERROR", message: c.error ?? "No price found" }, {}, "PAYG", 0);
  const msg = [c.status === "WARN" ? "Uses default usage assumptions - review" : "", ...c.notes].filter(Boolean).join("; ");
  if (c.status === "INFO") {
    const r = finalise({ ...common, status: "INFO", message: msg }, { payg: 0 }, "PAYG", discountPct);
    return { ...r, status: "INFO" };
  }
  const r = finalise({ ...common, status: c.status, message: msg }, { payg: (c.monthly ?? 0) * qty }, choice, discountPct);
  return r;
}
const fmtQ = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

/**
 * Estimate many rows with bounded concurrency; identical lookups are deduped by the cache.
 * Rows not finished within `deadlineMs` come back as ERROR rows so the caller always gets a complete,
 * JSON-serialisable result before the serverless function time limit.
 */
export async function estimateRows(rows: InputRow[], currency = "GBP", discountPct = 0, concurrency = 6, deadlineMs = 45_000) {
  const out: ResultRow[] = new Array(rows.length);
  let idx = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((r) => { timer = setTimeout(r, deadlineMs); });
  const work = Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (idx < rows.length) {
      const i = idx++;
      try { out[i] = await estimateRow(rows[i], currency, discountPct); }
      catch (e: any) { out[i] = rowError(rows[i], `Unexpected error: ${e?.message ?? e}`); }
    }
  }));
  await Promise.race([work, deadline]);
  clearTimeout(timer);
  let timedOut = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!out[i]) { out[i] = rowError(rows[i], `Timed out waiting for the Azure prices API after ${Math.round(deadlineMs / 1000)}s; retry`); timedOut++; }
  }
  const sum = (k: keyof ResultRow) => r2(out.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0)) ?? 0;
  const payg = out.reduce((a, r) => a + (r.chosen_month != null ? r.payg_month ?? 0 : 0), 0);
  const cm = sum("chosen_month");
  const totals: Totals = { payg_month: r2(payg) ?? 0, chosen_month: cm, chosen_year: r2(cm * 12) ?? 0, saving_vs_payg_pct: payg ? r2((1 - cm / payg) * 100) ?? 0 : 0 };
  return { currency, discount_pct: discountPct, rows: out, totals, ...(timedOut ? { warning: `${timedOut} row(s) timed out; retry to price them` } : {}) };
}

function rowError(row: InputRow, message: string): ResultRow {
  const r: InputRow = row && typeof row === "object" ? row : {};
  return finalise({
    name: String(r.name ?? ""), service: String(r.service ?? ""), arm_sku: String(r.arm_sku ?? ""), region: String(r.region ?? ""),
    quantity: num(r.quantity, 1), hours_per_month: num(r.hours_per_month, 730), os: String(r.os ?? ""), pricing: String(r.pricing ?? "PAYG"),
    status: "ERROR", message,
  }, {}, "PAYG", 0);
}
