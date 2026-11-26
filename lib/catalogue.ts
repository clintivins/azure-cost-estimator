/**
 * Service-aware pricing catalogue.
 *
 * Maps friendly service names and deployment SKUs (e.g. "Standard_LRS", "PrivateEndpoint", "workspace-based")
 * to Azure Retail Prices API meters and a usage model (units x hours, GB stored, operations, queries, MAU...).
 * Every price comes from the live Retail Prices API; nothing here is a price. Constants in this file are
 * only meter names and documented plan sizes (e.g. EP1 = 1 vCPU / 3.5 GB).
 */
import { queryPrices, esc, PriceItem } from "./azure";

export type CatStatus = "OK" | "WARN" | "INFO" | "ERROR";

/** One billable component of a line, e.g. "API Management Standard v2 Unit". */
export interface Component {
  label: string;
  product?: Pattern;
  sku?: Pattern;
  meter: Pattern;
  unit?: RegExp;
  /** Quantity in the meter's natural units (hours, GB, operations, queries, tokens...), before the meter's unit divisor. */
  qty: number;
  /** Free-text driver shown to the user, e.g. "100 GB stored". */
  driver: string;
}

export type Pattern = string | RegExp | ((s: string) => boolean);

export interface ComponentResult {
  label: string; meter: string; product: string; sku: string; unit: string;
  unit_price: number; quantity: number; monthly: number; tiered: boolean;
}

export interface CatalogueResult {
  status: CatStatus;
  service: string;
  sku: string;
  monthly: number | null;
  components: ComponentResult[];
  assumptions: string[];
  notes: string[];
  error?: string;
}

// ---------- usage ----------

const NUM_RE = /^-?\d+(\.\d+)?$/;
/** Reads usage drivers from row columns or a free-text `usage` column ("gb_stored=500; read_10k=20"). */
export class Usage {
  readonly assumptions: string[] = [];
  readonly explicit: string[] = [];
  private readonly extra: Record<string, number> = {};
  constructor(private readonly row: Record<string, unknown>) {
    const u = String(row.usage ?? "");
    for (const part of u.split(/[;,\n]+/)) {
      const m = part.match(/^\s*([a-z0-9_ ]+?)\s*[=:]\s*([\d.]+)\s*$/i);
      if (m) this.extra[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = Number(m[2]);
    }
  }
  has(key: string): boolean { return this.raw(key) != null; }
  private raw(key: string): number | undefined {
    const v = this.row[key];
    if (v != null && String(v).trim() !== "") {
      const s = String(v).trim().replace(/,/g, "");
      if (NUM_RE.test(s)) return Number(s);
    }
    return this.extra[key];
  }
  /** Value of the first key present; otherwise the default, recorded as an assumption. */
  get(keys: string | string[], def: number, describe: (n: number) => string): number {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      const v = this.raw(k);
      if (v != null && v >= 0) { this.explicit.push(describe(v)); return v; }
    }
    this.assumptions.push(`${describe(def)} (default; set ${Array.isArray(keys) ? keys[0] : keys})`);
    return def;
  }
  text(key: string): string { return String(this.row[key] ?? "").trim(); }
}

// ---------- matching helpers ----------

export const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const match = (v: string, p?: Pattern) => p == null || (typeof p === "string" ? v.toLowerCase() === p.toLowerCase() : typeof p === "function" ? p(v) : p.test(v));
const show = (p: Pattern) => (typeof p === "function" ? "(custom)" : String(p));
const fmtN = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { maximumFractionDigits: 2 }));

/** "10K" -> 10000, "1M/Month" -> 1e6, "1 GB/Month" -> 1, "100 Hours" -> 100, "10" -> 10. */
export function unitDivisor(unit: string): number {
  const m = unit.trim().match(/^(\d+(?:\.\d+)?)\s*([KM])?(?![a-z])/i);
  if (!m) return 1;
  const base = Number(m[1]);
  return m[2] ? base * (m[2].toUpperCase() === "K" ? 1e3 : 1e6) : base;
}

/** Graduated (tiered) cost: tierMinimumUnits are in the meter's price units. */
export function tieredCost(tiers: { min: number; price: number }[], units: number): number {
  const t = [...tiers].sort((a, b) => a.min - b.min);
  let cost = 0;
  for (let i = 0; i < t.length; i++) {
    const lo = t[i].min, hi = i + 1 < t.length ? t[i + 1].min : Infinity;
    if (units > lo) cost += (Math.min(units, hi) - lo) * t[i].price;
  }
  return cost;
}

export function priceComponent(items: PriceItem[], c: Component): ComponentResult | undefined {
  const hits = items.filter((i) => i.type === "Consumption" && match(i.meterName, c.meter) && match(i.productName, c.product) && match(i.skuName, c.sku) && (!c.unit || c.unit.test(i.unitOfMeasure)));
  if (!hits.length) return undefined;
  // Keep one product/sku/unit combination (the first match), then its tiers.
  const f = hits[0];
  const same = hits.filter((i) => i.productName === f.productName && i.skuName === f.skuName && i.meterName === f.meterName && i.unitOfMeasure === f.unitOfMeasure);
  const byMin = new Map<number, number>();
  for (const i of same) { const m = Number((i as any).tierMinimumUnits ?? 0); if (!byMin.has(m)) byMin.set(m, i.retailPrice); }
  const tiers = [...byMin].map(([min, price]) => ({ min, price }));
  const units = c.qty / unitDivisor(f.unitOfMeasure);
  const monthly = tieredCost(tiers, units);
  const paid = tiers.filter((t) => t.price > 0).sort((a, b) => a.min - b.min)[0];
  return {
    label: c.label, meter: f.meterName, product: f.productName, sku: f.skuName, unit: f.unitOfMeasure,
    unit_price: paid?.price ?? tiers[0].price, quantity: Math.round(units * 1e6) / 1e6, monthly, tiered: tiers.length > 1,
  };
}

// ---------- regions ----------

/** Azure billing zone used by DNS / Front Door meters. Zone 1 = Europe & North America. */
export function billingZone(region: string): string {
  const r = region.toLowerCase();
  if (/^brazil/.test(r)) return "Zone 3";
  if (/^(usgov|usdod)/.test(r)) return "US Gov Zone 1";
  if (/(asia|australia|japan|korea|india|singapore|hongkong|uae|qatar|israel|southafrica|indonesia|malaysia|newzealand|taiwan|saudi)/.test(r)) return "Zone 2";
  return "Zone 1";
}

// ---------- catalogue ----------

interface Ctx { sku: string; u: Usage; hours: number; os: string; region: string; label: string; rawSku: string }
interface Built { components?: Component[]; info?: string; error?: string; notes?: string[] }
interface Entry {
  id: string;
  label: string;
  aliases: string[];
  /** canonical sku -> aliases (normalised before comparison). "" alias = default when SKU blank. */
  skus: Record<string, string[]>;
  /** free-form SKU resolver for families like App Service plans. */
  resolveSku?: (raw: string) => string | undefined;
  defaultSku?: (ctx: { service: string; name: string }) => string;
  region: "regional" | "global" | "zone";
  filter: (armRegion: string) => string;
  build: (c: Ctx) => Built;
  /** extra assumption always stated. */
  hint: string;
}

const HOURS = (c: Ctx) => { c.u.explicit.push(`${c.hours} h/month`); return c.hours; };

const plan = (vcpu: number, gb: number) => ({ vcpu, gb });
const EP: Record<string, { vcpu: number; gb: number }> = { EP1: plan(1, 3.5), EP2: plan(2, 7), EP3: plan(4, 14) };
const WS: Record<string, { vcpu: number; gb: number }> = { WS1: plan(1, 3.5), WS2: plan(2, 7), WS3: plan(4, 14) };

export const CATALOGUE: Entry[] = [
  {
    id: "apim", label: "API Management", region: "regional",
    aliases: ["api management", "apim", "api management service", "microsoft.apimanagement/service", "azure api management"],
    skus: {
      Developer: ["developer", "dev"], Basic: ["basic"], Standard: ["standard"], Premium: ["premium"],
      "Basic v2": ["basicv2", "basic_v2"], "Standard v2": ["standardv2", "standard_v2", ""], "Premium v2": ["premiumv2", "premium_v2"],
      Consumption: ["consumption"],
    },
    filter: (r) => `serviceName eq 'API Management' and armRegionName eq '${esc(r)}'`,
    hint: "API Management: quantity = units (scale units) per instance, billed per hour",
    build: (c) => {
      if (c.sku === "Consumption") {
        const calls = c.u.get(["calls_million"], 1, (n) => `${fmtN(n)}M API calls/month`) * 1e6;
        return { components: [{ label: "Calls", sku: "Consumption", meter: "Consumption Calls", qty: calls, driver: `${fmtN(calls)} calls` }], notes: ["Consumption tier: first 1M calls/month free"] };
      }
      const h = HOURS(c);
      const comps: Component[] = [{ label: "Units", sku: c.sku, meter: `${c.sku} Unit`, unit: /hour/i, qty: h, driver: `${h} h` }];
      if (/v2$/.test(c.sku) && c.u.has("calls_million")) {
        const calls = c.u.get(["calls_million"], 0, (n) => `${fmtN(n)}M API calls/month`) * 1e6;
        comps.push({ label: "Calls above included", sku: c.sku, meter: `${c.sku} Calls`, qty: calls, driver: `${fmtN(calls)} calls` });
      }
      const notes = c.sku === "Developer" ? ["Developer tier has no SLA: use for dev/test only"] : /v2$/.test(c.sku) ? ["v2 tiers include an API call allowance; set calls_million to price overage"] : [];
      return { components: comps, notes };
    },
  },
  {
    id: "storage", label: "Storage account (Blob)", region: "regional",
    aliases: ["storage", "storage account", "storage accounts", "blob storage", "blob", "microsoft.storage/storageaccounts", "azure storage", "adls", "data lake storage"],
    skus: {},
    resolveSku: (raw) => {
      const s = raw.toUpperCase().replace(/[\s_]/g, "");
      if (/PREMIUM/.test(s)) return undefined;
      const red = s.match(/RAGZRS|RA-GZRS|RAGRS|RA-GRS|GZRS|GRS|ZRS|LRS/)?.[0]?.replace(/^RA-?/, "RA-");
      const tier = s.match(/HOT|COOL|COLD|ARCHIVE/)?.[0];
      if (!red && !tier && s !== "" && s !== "STANDARD" && s !== "STORAGEV2") return undefined;
      return `${tier ? tier[0] + tier.slice(1).toLowerCase() : ""}|${red ?? ""}`;
    },
    filter: (r) => `serviceName eq 'Storage' and armRegionName eq '${esc(r)}' and productName eq 'General Block Blob v2'`,
    hint: "Storage: General Purpose v2 block blob, flat namespace; GB stored + write/read operations",
    build: (c) => {
      let [tier, red] = c.sku.split("|");
      if (!tier) { tier = c.u.text("access_tier") ? c.u.text("access_tier")[0].toUpperCase() + c.u.text("access_tier").slice(1).toLowerCase() : ""; }
      if (!tier) { tier = "Hot"; c.u.assumptions.push("Hot access tier (default; set access_tier)"); }
      if (!red) { red = "LRS"; c.u.assumptions.push("LRS redundancy (default; use a SKU like Standard_ZRS)"); }
      const sku = `${tier} ${red}`;
      const gb = c.u.get(["gb_stored"], 100, (n) => `${fmtN(n)} GB stored`);
      let w: number, r: number;
      if (!c.u.has("write_10k") && !c.u.has("read_10k") && c.u.has("transactions_10k")) {
        const t = c.u.get(["transactions_10k"], 0, (n) => `${fmtN(n)} x 10K transactions`);
        w = t * 0.2; r = t * 0.8;
        c.u.assumptions.push("transactions split 20% write / 80% read");
      } else {
        w = c.u.get(["write_10k"], 10, (n) => `${fmtN(n * 1e4)} write operations`);
        r = c.u.get(["read_10k"], 100, (n) => `${fmtN(n * 1e4)} read operations`);
      }
      return {
        components: [
          { label: "Data stored", product: "General Block Blob v2", sku, meter: /Data Stored$/, qty: gb, driver: `${fmtN(gb)} GB` },
          { label: "Write operations", product: "General Block Blob v2", sku, meter: /Write Operations$/, qty: w * 1e4, driver: `${fmtN(w * 1e4)} ops` },
          { label: "Read operations", product: "General Block Blob v2", sku, meter: /^(?!.*Priority).*Read Operations$/, qty: r * 1e4, driver: `${fmtN(r * 1e4)} ops` },
        ],
        notes: ["Excludes egress, data retrieval (Cool/Cold/Archive) and other operation types"],
      };
    },
  },
  {
    id: "privateendpoint", label: "Private Endpoint", region: "global",
    aliases: ["private endpoint", "private endpoints", "private link", "privateendpoint", "microsoft.network/privateendpoints"],
    skus: { Standard: ["standard", "privateendpoint", "private endpoint", "pe", ""] },
    filter: () => `productName eq 'Virtual Network Private Link' and armRegionName eq 'Global'`,
    hint: "Private Endpoint: quantity = endpoints; endpoint hours + GB processed in/out",
    build: (c) => {
      const h = HOURS(c);
      let gin: number, gout: number;
      if (c.u.has("gb_in") || c.u.has("gb_out")) {
        gin = c.u.get(["gb_in"], 0, (n) => `${fmtN(n)} GB processed in`); gout = c.u.get(["gb_out"], 0, (n) => `${fmtN(n)} GB processed out`);
      } else {
        const g = c.u.get(["gb_processed"], 10, (n) => `${fmtN(n)} GB processed`);
        gin = g / 2; gout = g / 2;
        c.u.assumptions.push("GB processed split 50% ingress / 50% egress");
      }
      return {
        components: [
          { label: "Endpoint hours", sku: "Standard", meter: "Standard Private Endpoint", qty: h, driver: `${h} h` },
          { label: "Data processed in", sku: "Standard", meter: "Standard Data Processed - Ingress", qty: gin, driver: `${fmtN(gin)} GB` },
          { label: "Data processed out", sku: "Standard", meter: "Standard Data Processed - Egress", qty: gout, driver: `${fmtN(gout)} GB` },
        ],
      };
    },
  },
  {
    id: "dns", label: "Azure DNS", region: "zone",
    aliases: ["dns", "azure dns", "dns zone", "private dns", "private dns zone", "private dns zones", "privatednszone", "microsoft.network/privatednszones", "microsoft.network/dnszones", "public dns"],
    skus: { Private: ["private", "privatednszone", "privatedns", "privatezone"], Public: ["public", "publicdnszone", "dnszone", "publiczone"] },
    defaultSku: ({ service, name }) => (/public/i.test(service) ? "Public" : /private/i.test(service + " " + name) ? "Private" : "Public"),
    filter: (z) => `serviceName eq 'Azure DNS' and armRegionName eq '${esc(z)}'`,
    hint: "DNS: quantity = hosted zones; per-zone monthly fee + queries per million",
    build: (c) => {
      const q = c.u.get(["queries_million"], 1, (n) => `${fmtN(n)}M queries/month per zone`) * 1e6;
      return {
        components: [
          { label: "Hosted zone", sku: c.sku, meter: `${c.sku} Zone`, qty: 1, driver: "1 zone" },
          { label: "Queries", sku: c.sku, meter: `${c.sku} Queries`, qty: q, driver: `${fmtN(q)} queries` },
        ],
        notes: ["Zone fee drops after the first 25 zones per subscription (first-tier price used per line)"],
      };
    },
  },
  {
    id: "loganalytics", label: "Log Analytics / Application Insights", region: "regional",
    aliases: ["log analytics", "log analytics workspace", "application insights", "app insights", "appinsights", "microsoft.insights/components", "microsoft.operationalinsights/workspaces", "azure monitor logs"],
    skus: { Analytics: ["workspacebased", "workspace", "pergb2018", "pergb", "analytics", "analyticslogs", "payg", "payasyougo", "standard", ""] },
    filter: (r) => `serviceName eq 'Log Analytics' and armRegionName eq '${esc(r)}'`,
    hint: "Log Analytics / workspace-based Application Insights: GB ingested (Analytics logs) + retention beyond the included period",
    build: (c) => {
      const isAi = /insight/i.test(c.label);
      const included = isAi ? 90 : 31;
      const gb = c.u.get(["gb_ingested"], 10, (n) => `${fmtN(n)} GB ingested/month`);
      const days = c.u.get(["retention_days"], included, (n) => `${n} days retention`);
      const retained = days > included ? gb * (days - included) / 30 : 0;
      const comps: Component[] = [{ label: "Data ingestion", sku: "Analytics Logs", meter: "Analytics Logs Data Ingestion", qty: gb, driver: `${fmtN(gb)} GB` }];
      if (retained > 0) comps.push({ label: "Retention beyond included", sku: "Analytics Logs", meter: "Analytics Logs Data Retention", qty: retained, driver: `${fmtN(retained)} GB-month` });
      return {
        components: comps,
        notes: [
          `${isAi ? "Workspace-based Application Insights is billed as Log Analytics ingestion; " : ""}${included} days retention included`,
          "First 5 GB/month ingestion is free per billing account (applied to this line)",
        ],
      };
    },
  },
  {
    id: "alerts", label: "Azure Monitor alerts", region: "regional",
    aliases: ["azure monitor alerts", "monitor alerts", "alerts", "alert rules", "metric alerts", "log alerts", "azure monitor", "microsoft.insights/metricalerts", "microsoft.insights/scheduledqueryrules", "monitoring alerts"],
    skus: { Metric: ["metricalerts", "metric", "metricalert", "metrics", ""], Log: ["logalerts", "log", "logalert", "scheduledqueryrules", "logsearch", "logsearchalerts"] },
    defaultSku: ({ service }) => (/log/i.test(service) ? "Log" : "Metric"),
    filter: (r) => `serviceName eq 'Azure Monitor' and armRegionName eq '${esc(r)}'`,
    hint: "Alerts: metric alerts per time series monitored; log alerts per rule by frequency",
    build: (c) => {
      if (c.sku === "Log") {
        const rules = c.u.get(["alert_rules"], 5, (n) => `${fmtN(n)} log alert rules`);
        const f = c.u.get(["alert_frequency_min"], 5, (n) => `evaluated every ${n} min`);
        const freq = [1, 5, 10, 15].includes(f) ? f : 5;
        return { components: [{ label: "Log alert rules", sku: "Alerts", meter: `Alerts System Log Monitored at ${freq} Minute Frequency`, qty: rules, driver: `${fmtN(rules)} rules` }] };
      }
      const rules = c.u.get(["alert_rules"], 10, (n) => `${fmtN(n)} metric alert rules`);
      const ts = c.u.get(["time_series"], 1, (n) => `${fmtN(n)} time series per rule`);
      return {
        components: [{ label: "Metric time series monitored", sku: "Alerts", meter: "Alerts Metric Monitored", qty: rules * ts, driver: `${fmtN(rules * ts)} time series` }],
        notes: ["First 10 metric time series are free (applied to this line); action-group notifications (email/SMS) not included"],
      };
    },
  },
  {
    id: "externalid", label: "Microsoft Entra External ID", region: "global",
    aliases: ["entra external id", "external id", "microsoft entra external id", "entra externalid", "ciam", "azure ad external identities", "external identities"],
    skus: { Core: ["core", "mau", "monthlyactiveusers", ""], Basic: ["basic"], M2M: ["m2mtoken", "m2m", "m2mauthentication", "m2mtokens", "clientcredentials"] },
    filter: () => `productName eq 'Microsoft Entra External ID'`,
    hint: "Entra External ID: MAU (first 50,000 free) or M2M tokens",
    build: (c) => {
      if (c.sku === "M2M") {
        const t = c.u.get(["tokens"], 10000, (n) => `${fmtN(n)} M2M tokens/month`);
        return {
          components: [{ label: "M2M tokens", sku: "M2M Authentication", meter: "M2M Authentication Token", qty: t, driver: `${fmtN(t)} tokens` }],
          notes: ["M2M is a premium add-on billed per token issued; MAU charges not included in this line"],
        };
      }
      const mau = c.u.get(["mau"], 50000, (n) => `${fmtN(n)} monthly active users`);
      return {
        components: [{ label: "Monthly active users", sku: c.sku, meter: `${c.sku} Monthly Active Users`, qty: mau, driver: `${fmtN(mau)} MAU` }],
        notes: ["First 50,000 MAU free; add-ons (phone/SMS MFA, Go-Local, ID Governance) are separate meters"],
      };
    },
  },
  {
    id: "managedidentity", label: "Managed Identity", region: "global",
    aliases: ["managed identity", "managed identities", "user assigned managed identity", "user-assigned managed identity", "user assigned identity", "msi", "microsoft.managedidentity/userassignedidentities", "system assigned managed identity"],
    skus: { UserAssigned: ["userassigned", "user", "uami", ""], SystemAssigned: ["systemassigned", "system", "sami"] },
    filter: () => "",
    hint: "Managed Identity has no direct charge",
    build: () => ({ info: "No direct charge: managed identities and their Entra ID tokens are free. Costs come from the resources they access." }),
  },
  {
    id: "functions", label: "Azure Functions", region: "regional",
    aliases: ["functions", "function app", "function apps", "azure functions", "functionapp", "azure function"],
    skus: {
      Consumption: ["consumption", "y1", "dynamic", ""], Flex: ["flex", "flexconsumption", "fc1"],
      EP1: ["ep1", "elasticpremiumep1", "premiumep1"], EP2: ["ep2", "elasticpremiumep2", "premiumep2"], EP3: ["ep3", "elasticpremiumep3", "premiumep3"],
    },
    filter: (r) => `serviceName eq 'Functions' and armRegionName eq '${esc(r)}'`,
    hint: "Functions: Consumption/Flex = executions + GB-seconds; Premium EPn = vCPU + memory hours per instance",
    build: (c) => {
      if (c.sku in EP) {
        const h = HOURS(c), p = EP[c.sku];
        return {
          components: [
            { label: "vCPU hours", product: "Premium Functions", meter: "Premium vCPU Duration", qty: p.vcpu * h, driver: `${p.vcpu} vCPU x ${h} h` },
            { label: "Memory hours", product: "Premium Functions", meter: "Premium Memory Duration", qty: p.gb * h, driver: `${p.gb} GB x ${h} h` },
          ],
          notes: [`${c.sku} = ${p.vcpu} vCPU / ${p.gb} GB per instance; quantity = always-ready instances`],
        };
      }
      const ex = c.u.get(["executions_million"], 1, (n) => `${fmtN(n)}M executions/month`) * 1e6;
      const memGb = c.sku === "Flex" ? 2 : 0.5;
      const gbs = c.u.get(["gb_seconds"], ex * 0.2 * memGb, (n) => `${fmtN(n)} GB-seconds (200 ms x ${memGb} GB per execution)`);
      const [product, sku, pre] = c.sku === "Flex" ? ["Flex Consumption", "On Demand", "On Demand"] : ["Functions", "Standard", "Standard"];
      return {
        components: [
          { label: "Executions", product, sku, meter: `${pre} Total Executions`, qty: ex, driver: `${fmtN(ex)} executions` },
          { label: "Execution time", product, sku, meter: `${pre} Execution Time`, qty: gbs, driver: `${fmtN(gbs)} GB-s` },
        ],
        notes: ["Monthly free grant applied to this line; storage account for the Function app priced separately"],
      };
    },
  },
  {
    id: "logicapps", label: "Logic Apps", region: "regional",
    aliases: ["logic apps", "logic app", "logicapp", "logicapps", "logic apps standard", "logic apps consumption", "microsoft.logic/workflows"],
    skus: { WS1: ["ws1", "standardws1", "workflowstandardws1"], WS2: ["ws2", "standardws2"], WS3: ["ws3", "standardws3"], Consumption: ["consumption", "multitenant"] },
    defaultSku: ({ service }) => (/standard/i.test(service) ? "WS1" : "Consumption"),
    filter: (r) => `serviceName eq 'Logic Apps' and armRegionName eq '${esc(r)}'`,
    hint: "Logic Apps: Standard WSn = vCPU + memory hours; Consumption = per action",
    build: (c) => {
      if (c.sku in WS) {
        const h = HOURS(c), p = WS[c.sku];
        return {
          components: [
            { label: "vCPU hours", product: "Logic Apps", sku: "Standard", meter: "Standard vCPU Duration", qty: p.vcpu * h, driver: `${p.vcpu} vCPU x ${h} h` },
            { label: "Memory hours", product: "Logic Apps", sku: "Standard", meter: "Standard Memory Duration", qty: p.gb * h, driver: `${p.gb} GB x ${h} h` },
          ],
          notes: [`${c.sku} = ${p.vcpu} vCPU / ${p.gb} GB per instance; built-in operations included; storage account priced separately`],
        };
      }
      const b = c.u.get(["actions"], 100000, (n) => `${fmtN(n)} built-in actions/month`);
      const s = c.u.get(["connector_actions"], 10000, (n) => `${fmtN(n)} standard connector actions/month`);
      const e = c.u.get(["enterprise_actions"], 0, (n) => `${fmtN(n)} enterprise connector actions/month`);
      const comps: Component[] = [
        { label: "Built-in actions", product: "Logic Apps", sku: "Consumption", meter: "Consumption Built-in Actions", qty: b, driver: `${fmtN(b)} actions` },
        { label: "Standard connector actions", product: "Logic Apps", sku: "Consumption", meter: "Consumption Standard Connector Actions", qty: s, driver: `${fmtN(s)} actions` },
      ];
      if (e > 0) comps.push({ label: "Enterprise connector actions", product: "Logic Apps", sku: "Consumption", meter: "Consumption Enterprise Connector Actions", qty: e, driver: `${fmtN(e)} actions` });
      return { components: comps };
    },
  },
  {
    id: "servicebus", label: "Service Bus", region: "regional",
    aliases: ["service bus", "servicebus", "azure service bus", "microsoft.servicebus/namespaces"],
    skus: { Basic: ["basic"], Standard: ["standard", ""], Premium: ["premium", "premium1", "premium1mu"] },
    filter: (r) => `serviceName eq 'Service Bus' and armRegionName eq '${esc(r)}'`,
    hint: "Service Bus: Premium = messaging units x hours (quantity = MUs); Standard = base charge + operations; Basic = operations",
    build: (c) => {
      if (c.sku === "Premium") { const h = HOURS(c); return { components: [{ label: "Messaging units", sku: "Premium", meter: "Premium Messaging Unit", qty: h, driver: `${h} h` }] }; }
      const ops = c.u.get(["messages_million"], 1, (n) => `${fmtN(n)}M messaging operations/month`) * 1e6;
      if (c.sku === "Basic") return { components: [{ label: "Operations", sku: "Basic", meter: "Basic Messaging Operations", qty: ops, driver: `${fmtN(ops)} ops` }] };
      const h = HOURS(c);
      return {
        components: [
          { label: "Base charge", sku: "Standard", meter: "Standard Base Unit", unit: /hour/i, qty: h, driver: `${h} h` },
          { label: "Operations", sku: "Standard", meter: "Standard Messaging Operations", qty: ops, driver: `${fmtN(ops)} ops` },
        ],
        notes: ["Standard includes the first 13M operations/month"],
      };
    },
  },
  {
    id: "keyvault", label: "Key Vault", region: "regional",
    aliases: ["key vault", "keyvault", "azure key vault", "akv", "microsoft.keyvault/vaults"],
    skus: { Standard: ["standard", ""], Premium: ["premium"] },
    filter: (r) => `serviceName eq 'Key Vault' and armRegionName eq '${esc(r)}'`,
    hint: "Key Vault: operations per 10K (+ HSM keys on Premium)",
    build: (c) => {
      const ops = c.u.get(["ops_10k", "transactions_10k"], 10, (n) => `${fmtN(n * 1e4)} operations/month`) * 1e4;
      const comps: Component[] = [{ label: "Operations", product: "Key Vault", sku: c.sku, meter: "Operations", qty: ops, driver: `${fmtN(ops)} ops` }];
      if (c.sku === "Premium" && c.u.has("hsm_keys")) {
        const k = c.u.get(["hsm_keys"], 0, (n) => `${fmtN(n)} HSM-protected RSA 2048 keys`);
        comps.push({ label: "HSM keys", product: "Key Vault", sku: "Premium", meter: "Premium HSM-protected RSA 2048-bit key", qty: k, driver: `${fmtN(k)} keys` });
      }
      return { components: comps, notes: ["Certificate renewals, key rotations and advanced key operations are separate meters"] };
    },
  },
  {
    id: "appservice", label: "App Service plan", region: "regional",
    aliases: ["app service", "app service plan", "web app", "webapp", "app service plans", "microsoft.web/serverfarms", "asp"],
    skus: {},
    resolveSku: (raw) => { const n = norm(raw).replace(/^(standard|basic|premium)(?=[bsp]\d)/, ""); return /^(b[1-3]|s[1-3]|p[1-3]v2|p[0-5]m?v3)$/.test(n) ? n : undefined; },
    filter: (r) => `serviceName eq 'Azure App Service' and armRegionName eq '${esc(r)}'`,
    hint: "App Service: quantity = instances, plan hours; OS from the os column",
    build: (c) => {
      const h = HOURS(c);
      const linux = !/^win/i.test(c.os);
      if (!c.u.text("os")) c.u.assumptions.push("Linux plan (default; set os)");
      const fam = /^b/.test(c.sku) ? "Basic" : /^s/.test(c.sku) ? "Standard" : /v2$/.test(c.sku) ? "Premium v2" : "Premium v3";
      const product = `Azure App Service ${fam} Plan${linux ? " - Linux" : ""}`;
      return { components: [{ label: "Plan instance hours", product, sku: (s: string) => norm(s) === c.sku, meter: /^(?!.*(Stamp|Isolated)).*/, unit: /hour/i, qty: h, driver: `${h} h` }] };
    },
  },
  {
    id: "frontdoor", label: "Azure Front Door", region: "zone",
    aliases: ["front door", "azure front door", "afd", "frontdoor", "microsoft.cdn/profiles"],
    skus: { Standard: ["standard", "standardazurefrontdoor", ""], Premium: ["premium", "premiumazurefrontdoor"] },
    filter: (z) => `productName eq 'Azure Front Door' and armRegionName eq '${esc(z)}'`,
    hint: "Front Door Standard/Premium: monthly base fee + requests + data transfer out",
    build: (c) => {
      const rq = c.u.get(["requests_million"], 1, (n) => `${fmtN(n)}M requests/month`) * 1e6;
      const out = c.u.get(["gb_out"], 10, (n) => `${fmtN(n)} GB out to clients`);
      return {
        components: [
          { label: "Base fee", sku: c.sku, meter: `${c.sku} Base Fees`, qty: 1, driver: "1 profile" },
          { label: "Requests", sku: c.sku, meter: `${c.sku} Requests`, qty: rq, driver: `${fmtN(rq)} requests` },
          { label: "Data transfer out", sku: c.sku, meter: `${c.sku} Data Transfer Out`, qty: out, driver: `${fmtN(out)} GB` },
        ],
        notes: ["Edge-to-origin transfer and WAF add-ons not included"],
      };
    },
  },
  {
    id: "appgateway", label: "Application Gateway", region: "regional",
    aliases: ["application gateway", "app gateway", "appgw", "agw", "microsoft.network/applicationgateways"],
    skus: { "Standard v2": ["standardv2", "standard_v2", ""], "WAF v2": ["wafv2", "waf_v2", "waf"], "Basic v2": ["basicv2", "basic_v2", "basic"] },
    filter: (r) => `serviceName eq 'Application Gateway' and armRegionName eq '${esc(r)}'`,
    hint: "Application Gateway v2: fixed hourly cost + capacity units",
    build: (c) => {
      const h = HOURS(c);
      const cu = c.u.get(["capacity_units"], 1, (n) => `${fmtN(n)} capacity units on average`);
      const product = `Application Gateway ${c.sku}`;
      return {
        components: [
          { label: "Fixed cost", product, meter: /Fixed Cost$/, qty: h, driver: `${h} h` },
          { label: "Capacity units", product, meter: /Capacity Units$/, qty: cu * h, driver: `${fmtN(cu)} CU x ${h} h` },
        ],
      };
    },
  },
  {
    id: "eventgrid", label: "Event Grid", region: "regional",
    aliases: ["event grid", "eventgrid", "event grid topic", "event grid system topic", "microsoft.eventgrid/topics", "microsoft.eventgrid/systemtopics", "microsoft.eventgrid/namespaces"],
    skus: { Basic: ["basic", "topic", "systemtopic", ""], Namespace: ["standard", "namespace"] },
    filter: (r) => `serviceName eq 'Event Grid' and armRegionName eq '${esc(r)}'`,
    hint: "Event Grid: Basic topics = operations (first 100K free); Namespaces = throughput units + event operations",
    build: (c) => {
      const ops = c.u.get(["ops_million"], 1, (n) => `${fmtN(n)}M operations/month`) * 1e6;
      if (c.sku === "Namespace") {
        const h = HOURS(c);
        return { components: [
          { label: "Throughput units", sku: "Standard", meter: "Standard Throughput Unit", qty: h, driver: `${h} h` },
          { label: "Event operations", sku: "Standard", meter: "Standard Event Operations", qty: ops, driver: `${fmtN(ops)} ops` },
        ] };
      }
      return { components: [{ label: "Operations", sku: "Standard", meter: "Standard Operations", qty: ops, driver: `${fmtN(ops)} ops` }] };
    },
  },
  {
    id: "cosmos", label: "Azure Cosmos DB (NoSQL)", region: "regional",
    aliases: ["cosmos db", "cosmosdb", "azure cosmos db", "cosmos", "microsoft.documentdb/databaseaccounts"],
    skus: { Provisioned: ["provisioned", "standard", "manual", "ru", "rus", ""], Serverless: ["serverless"] },
    filter: (r) => `serviceName eq 'Azure Cosmos DB' and armRegionName eq '${esc(r)}'`,
    hint: "Cosmos DB: provisioned RU/s x hours (or serverless RUs) + GB stored, single region",
    build: (c) => {
      const gb = c.u.get(["gb_stored"], 10, (n) => `${fmtN(n)} GB stored`);
      const storage: Component = { label: "Data stored", product: "Azure Cosmos DB", sku: "RUs", meter: "Data Stored", qty: gb, driver: `${fmtN(gb)} GB` };
      if (c.sku === "Serverless") {
        const ru = c.u.get(["ru_million"], 10, (n) => `${fmtN(n)}M RUs/month`) * 1e6;
        return { components: [{ label: "Request units", product: "Azure Cosmos DB serverless", meter: "1M RUs", qty: ru, driver: `${fmtN(ru)} RUs` }, storage],
          notes: ["Storage priced on the standard Cosmos DB 'Data Stored' meter"] };
      }
      const h = HOURS(c);
      const ru = c.u.get(["ru_per_sec"], 400, (n) => `${fmtN(n)} RU/s provisioned`);
      return { components: [{ label: "Provisioned throughput", product: "Azure Cosmos DB", sku: "RUs", meter: "100 RU/s", qty: (ru / 100) * h, driver: `${fmtN(ru)} RU/s x ${h} h` }, storage],
        notes: ["Single region, manual throughput; backup beyond the free periodic copies not included"] };
    },
  },
];

// ---------- resolution ----------

export interface Resolved { entry: Entry; sku: string }

function skuOf(entry: Entry, raw: string, service: string, name: string): string | undefined {
  if (entry.resolveSku) return entry.resolveSku(raw);
  const n = norm(raw);
  for (const [canon, al] of Object.entries(entry.skus)) if (n !== "" && (norm(canon) === n || al.some((a) => norm(a) === n))) return canon;
  if (n === "") {
    if (entry.defaultSku) return entry.defaultSku({ service, name });
    return Object.entries(entry.skus).find(([, al]) => al.includes(""))?.[0];
  }
  return undefined;
}

/** Find the catalogue entry for a row: service column, then service_name, then a distinctive SKU, then the name. */
export function resolve(row: { service?: unknown; service_name?: unknown; arm_sku?: unknown; name?: unknown }): { entry?: Entry; sku?: string; reason?: string } {
  const service = String(row.service ?? "").trim(), sn = String(row.service_name ?? "").trim();
  const raw = String(row.arm_sku ?? "").trim(), name = String(row.name ?? "").trim();
  const byAlias = (s: string) => { const n = norm(s); return n ? CATALOGUE.find((e) => e.aliases.some((a) => norm(a) === n) || norm(e.label) === n) : undefined; };
  let entry = byAlias(service) ?? byAlias(sn);
  if (!entry) {
    // Distinctive SKU aliases (not shared words like "standard").
    const n = norm(raw);
    const generic = new Set(["", "standard", "basic", "premium", "free", "developer", "consumption"]);
    if (!generic.has(n)) {
      const hits = CATALOGUE.filter((e) => Object.values(e.skus).some((al) => al.some((a) => a && norm(a) === n)) || (e.resolveSku && e.id === "storage" && /^(standard|hot|cool|cold)_?(ra-?)?(lrs|zrs|grs|gzrs)$/i.test(raw)));
      if (hits.length === 1) entry = hits[0];
    }
  }
  if (!entry && name) {
    const nn = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const hits = CATALOGUE.filter((e) => e.aliases.some((a) => a.length > 3 && !a.includes("/") && nn.includes(` ${a} `)));
    if (hits.length === 1) entry = hits[0];
  }
  if (!entry) return {};
  const sku = skuOf(entry, raw, service || sn, name);
  if (!sku) {
    const opts = entry.resolveSku ? (entry.id === "storage" ? "Standard_LRS, Standard_ZRS, Standard_GRS, Standard_RAGRS, Standard_GZRS (optionally Hot/Cool/Cold)" : "B1-B3, S1-S3, P1v2-P3v2, P0v3-P3v3, P1mv3") : Object.keys(entry.skus).join(", ");
    return { entry, reason: `SKU '${raw}' is not a known ${entry.label} SKU (use ${opts})` };
  }
  return { entry, sku };
}

export const isCatalogueService = (row: Parameters<typeof resolve>[0]) => !!resolve(row).entry;

/** Price one row through the catalogue. Returns undefined when no catalogue entry matches. */
export async function priceCatalogue(row: Record<string, unknown>, region: string, hours: number, os: string, currency: string): Promise<CatalogueResult | undefined> {
  const r = resolve(row as any);
  if (!r.entry) return undefined;
  const e = r.entry;
  const base: CatalogueResult = { status: "OK", service: e.label, sku: r.sku ?? String(row.arm_sku ?? ""), monthly: null, components: [], assumptions: [], notes: [] };
  if (!r.sku) return { ...base, status: "ERROR", error: r.reason };
  const u = new Usage(row);
  const label = `${row.service ?? ""} ${row.service_name ?? ""} ${row.name ?? ""}`;
  const built = e.build({ sku: r.sku, u, hours, os, region, label, rawSku: String(row.arm_sku ?? "") });
  const notes = [e.hint, ...(built.notes ?? [])];
  if (built.info) return { ...base, status: "INFO", monthly: 0, notes: [built.info] };
  if (built.error || !built.components) return { ...base, status: "ERROR", error: built.error ?? "No pricing model" };
  const armRegion = e.region === "global" ? "Global" : e.region === "zone" ? billingZone(region) : region;
  if (e.region === "zone") u.explicit.push(`${armRegion} billing zone for ${region}`);
  const items = await queryPrices(e.filter(armRegion), currency);
  const out: ComponentResult[] = [];
  const missing: Component[] = [];
  for (const c of built.components) {
    const res = priceComponent(items, c);
    if (res) out.push(res); else missing.push(c);
  }
  if (missing.length) {
    const cands = [...new Set(items.filter((i) => i.type === "Consumption").map((i) => `${i.skuName} / ${i.meterName} (${i.unitOfMeasure})`))].slice(0, 10);
    const want = missing.map((m) => `${m.label} [meter ${show(m.meter)}${m.sku ? `, sku ${show(m.sku)}` : ""}${m.product ? `, product ${show(m.product)}` : ""}]`).join("; ");
    return { ...base, status: "ERROR", components: out, assumptions: u.assumptions, notes,
      error: `No retail meter found in ${armRegion} for ${want}.${cands.length ? ` Candidates: ${cands.join("; ")}` : " The Retail Prices API returned no meters for this service/region."}` };
  }
  const monthly = out.reduce((a, c) => a + c.monthly, 0);
  return { ...base, status: u.assumptions.length ? "WARN" : "OK", monthly, components: out, assumptions: [...u.explicit, ...u.assumptions], notes };
}

/** Usage drivers: column name (or key in the `usage` column), services it applies to, default when blank. */
export const DRIVERS: { key: string; services: string; default: string; meaning: string }[] = [
  { key: "gb_stored", services: "Storage, Cosmos DB", default: "100 (Storage), 10 (Cosmos)", meaning: "GB stored per month" },
  { key: "write_10k", services: "Storage", default: "10", meaning: "write operations, in 10,000s" },
  { key: "read_10k", services: "Storage", default: "100", meaning: "read operations, in 10,000s" },
  { key: "transactions_10k", services: "Storage, Key Vault", default: "-", meaning: "total transactions in 10,000s (Storage: split 20% write / 80% read)" },
  { key: "access_tier", services: "Storage", default: "Hot", meaning: "Hot | Cool | Cold | Archive (or put it in the SKU, e.g. Cool_LRS)" },
  { key: "gb_processed", services: "Private Endpoint", default: "10", meaning: "GB processed per endpoint (split 50/50 in/out); or set gb_in / gb_out" },
  { key: "queries_million", services: "DNS", default: "1", meaning: "DNS queries per zone, in millions" },
  { key: "gb_ingested", services: "Log Analytics, App Insights", default: "10", meaning: "GB ingested per month (first 5 GB free)" },
  { key: "retention_days", services: "Log Analytics, App Insights", default: "31 / 90 (included)", meaning: "retention; days beyond the included period are charged" },
  { key: "alert_rules", services: "Monitor alerts", default: "10 metric / 5 log", meaning: "number of alert rules" },
  { key: "time_series", services: "Monitor alerts (metric)", default: "1", meaning: "time series monitored per metric rule" },
  { key: "alert_frequency_min", services: "Monitor alerts (log)", default: "5", meaning: "1 | 5 | 10 | 15 minutes" },
  { key: "mau", services: "Entra External ID", default: "50000", meaning: "monthly active users (first 50,000 free)" },
  { key: "tokens", services: "Entra External ID (M2M)", default: "10000", meaning: "M2M tokens issued per month" },
  { key: "calls_million", services: "API Management", default: "1 (Consumption), unset for v2", meaning: "API calls per month, in millions" },
  { key: "executions_million", services: "Functions", default: "1", meaning: "executions per month, in millions" },
  { key: "gb_seconds", services: "Functions", default: "200 ms x 0.5 GB (2 GB Flex) per execution", meaning: "execution GB-seconds per month" },
  { key: "actions / connector_actions / enterprise_actions", services: "Logic Apps Consumption", default: "100000 / 10000 / 0", meaning: "actions per month" },
  { key: "messages_million", services: "Service Bus Basic/Standard", default: "1", meaning: "messaging operations per month, in millions" },
  { key: "ops_10k", services: "Key Vault", default: "10", meaning: "vault operations, in 10,000s" },
  { key: "hsm_keys", services: "Key Vault Premium", default: "0", meaning: "HSM-protected RSA 2048 keys" },
  { key: "requests_million", services: "Front Door", default: "1", meaning: "requests per month, in millions" },
  { key: "gb_out", services: "Front Door, Private Endpoint", default: "10 (Front Door)", meaning: "GB transferred out" },
  { key: "capacity_units", services: "Application Gateway v2", default: "1", meaning: "average capacity units" },
  { key: "ops_million", services: "Event Grid", default: "1", meaning: "operations per month, in millions" },
  { key: "ru_per_sec / ru_million", services: "Cosmos DB", default: "400 / 10", meaning: "provisioned RU/s, or serverless RUs in millions" },
];

/** Supported services and SKUs, for docs and the Help sheet. */
export const SUPPORTED = () => CATALOGUE.map((e) => ({
  service: e.label,
  names: e.aliases.filter((a) => !a.includes("/")).slice(0, 4).join(", "),
  skus: e.resolveSku ? (e.id === "storage" ? "Standard_LRS/ZRS/GRS/RAGRS/GZRS/RAGZRS, optional Hot/Cool/Cold/Archive" : "B1-B3, S1-S3, P1v2-P3v2, P0v3-P3v3, P1mv3-P5mv3") : Object.entries(e.skus).map(([k, al]) => (al.includes("") ? `${k} (default)` : k) + (al.filter((a) => a && norm(a) !== norm(k)).length ? ` [${al.filter((a) => a && norm(a) !== norm(k)).slice(0, 2).join(", ")}]` : "")).join(", "),
  model: e.hint,
}));
