import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "./fixtures/prices-uksouth-gbp.json";
import { CATALOGUE, priceCatalogue, resolve, tieredCost, unitDivisor, billingZone, Usage } from "@/lib/catalogue";
import { estimateRows } from "@/lib/estimate";

// Offline: serve recorded live Retail Prices responses (uksouth, GBP) by $filter.
const filters = (fixture as any).filters as Record<string, any[]>;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const f = new URL(u).searchParams.get("$filter") ?? "";
    const items = filters[f];
    if (!items) return new Response(JSON.stringify({ Items: [], NextPageLink: null }));
    return new Response(JSON.stringify({ Items: items, NextPageLink: null }), { headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const price = (f: string, p: (i: any) => boolean) => filters[f].filter(p);
const one = (f: string, p: (i: any) => boolean) => { const x = price(f, p); expect(x.length).toBeGreaterThan(0); return x[0].retailPrice as number; };
const est = async (row: any) => (await estimateRows([{ region: "uksouth", ...row }], "GBP", 0, 6, 10_000)).rows[0];

describe("helpers", () => {
  it("unit divisors", () => {
    expect(unitDivisor("10K")).toBe(1e4); expect(unitDivisor("1M/Month")).toBe(1e6); expect(unitDivisor("1 GB/Month")).toBe(1);
    expect(unitDivisor("100 Hours")).toBe(100); expect(unitDivisor("10")).toBe(10); expect(unitDivisor("1/Hour")).toBe(1);
  });
  it("graduated tiers", () => {
    expect(tieredCost([{ min: 0, price: 0 }, { min: 5, price: 2 }], 12)).toBe(14);
    expect(tieredCost([{ min: 0, price: 3 }, { min: 10, price: 1 }], 4)).toBe(12);
  });
  it("billing zones", () => { expect(billingZone("uksouth")).toBe("Zone 1"); expect(billingZone("australiaeast")).toBe("Zone 2"); expect(billingZone("brazilsouth")).toBe("Zone 3"); });
  it("usage reads columns, the usage string, and records defaults", () => {
    const u = new Usage({ gb_stored: "250", usage: "read_10k=7; queries million: 3" });
    expect(u.get("gb_stored", 100, String)).toBe(250);
    expect(u.get("read_10k", 100, String)).toBe(7);
    expect(u.get("queries_million", 1, String)).toBe(3);
    expect(u.get("write_10k", 10, (n) => `${n} writes`)).toBe(10);
    expect(u.assumptions).toEqual(["10 writes (default; set write_10k)"]);
  });
});

describe("resolution of Clint-style deployment SKUs", () => {
  const cases: [any, string, string][] = [
    [{ service: "API Management", arm_sku: "Standard_v2" }, "apim", "Standard v2"],
    [{ service: "APIM", arm_sku: "Developer" }, "apim", "Developer"],
    [{ service: "Storage Account", arm_sku: "Standard_LRS" }, "storage", "|LRS"],
    [{ service: "Other", arm_sku: "Standard_LRS", name: "x" }, "storage", "|LRS"],
    [{ service: "Private Endpoint", arm_sku: "PrivateEndpoint" }, "privateendpoint", "Standard"],
    [{ service: "Other", arm_sku: "PrivateDNSZone", name: "Private DNS Blob" }, "dns", "Private"],
    [{ service: "Application Insights", arm_sku: "workspace-based" }, "loganalytics", "Analytics"],
    [{ service: "Azure Monitor Alerts", arm_sku: "MetricAlerts" }, "alerts", "Metric"],
    [{ service: "Entra External ID", arm_sku: "M2M-token" }, "externalid", "M2M"],
    [{ service: "Managed Identity", arm_sku: "UserAssigned" }, "managedidentity", "UserAssigned"],
    [{ service: "", arm_sku: "UserAssigned", name: "Managed Identity" }, "managedidentity", "UserAssigned"],
    [{ service: "App Service", arm_sku: "P1v3" }, "appservice", "p1v3"],
    [{ service: "Logic Apps Standard", arm_sku: "" }, "logicapps", "WS1"],
  ];
  it.each(cases)("%o", (row, id, sku) => { const r = resolve(row); expect(r.entry?.id).toBe(id); expect(r.sku).toBe(sku); });
  it("unknown SKU for a known service gives a hint", () => {
    expect(resolve({ service: "API Management", arm_sku: "Gold" }).reason).toMatch(/Developer, Basic, Standard/);
  });
  it("VM-style SKUs are not captured", () => { expect(resolve({ service: "Other", arm_sku: "Standard_D4s_v5" }).entry).toBeUndefined(); });
});

const F = {
  apim: "serviceName eq 'API Management' and armRegionName eq 'uksouth'",
  st: "serviceName eq 'Storage' and armRegionName eq 'uksouth' and productName eq 'General Block Blob v2'",
  pe: "productName eq 'Virtual Network Private Link' and armRegionName eq 'Global'",
  dns: "serviceName eq 'Azure DNS' and armRegionName eq 'Zone 1'",
  la: "serviceName eq 'Log Analytics' and armRegionName eq 'uksouth'",
  mon: "serviceName eq 'Azure Monitor' and armRegionName eq 'uksouth'",
  ext: "productName eq 'Microsoft Entra External ID'",
};

describe("pricing models (recorded live meters)", () => {
  it("API Management: units x hours", async () => {
    const p = one(F.apim, (i) => i.meterName === "Standard v2 Unit");
    const r = await est({ service: "API Management", arm_sku: "Standard_v2", quantity: 2 });
    expect(r.status).toBe("OK");
    expect(r.payg_month).toBeCloseTo(p * 730 * 2, 2);
    expect(r.matched_meters).toMatch(/Standard v2 Unit/);
    expect(r.os).toBe("");
  });
  it("Storage: GB stored + write + read operations", async () => {
    const gb = one(F.st, (i) => i.meterName === "Hot LRS Data Stored" && i.tierMinimumUnits === 0);
    const w = one(F.st, (i) => i.skuName === "Hot LRS" && i.meterName === "Hot LRS Write Operations");
    const rd = one(F.st, (i) => i.skuName === "Hot LRS" && i.meterName === "Hot Read Operations");
    const r = await est({ service: "Storage Account", arm_sku: "Standard_LRS", gb_stored: 500, write_10k: 20, read_10k: 200 });
    expect(r.status).toBe("WARN"); // access tier defaulted
    expect(r.payg_month).toBeCloseTo(500 * gb + 20 * w + 200 * rd, 2);
    expect(r.assumptions).toMatch(/Hot access tier \(default/);
    expect(r.hours_per_month).toBeNull();
  });
  it("Private Endpoint: hours + GB in/out", async () => {
    const h = one(F.pe, (i) => i.meterName === "Standard Private Endpoint");
    const gin = one(F.pe, (i) => i.meterName === "Standard Data Processed - Ingress" && i.tierMinimumUnits === 0);
    const r = await est({ service: "Private Endpoint", arm_sku: "PrivateEndpoint", gb_in: 100, gb_out: 0 });
    expect(r.status).toBe("OK");
    expect(r.payg_month).toBeCloseTo(h * 730 + 100 * gin, 2);
  });
  it("Private DNS: zone + queries per million", async () => {
    const z = one(F.dns, (i) => i.meterName === "Private Zone" && i.tierMinimumUnits === 0);
    const q = one(F.dns, (i) => i.meterName === "Private Queries" && i.tierMinimumUnits === 0);
    const r = await est({ service: "Private DNS Zone", arm_sku: "PrivateDNSZone", queries_million: 3, quantity: 2 });
    expect(r.payg_month).toBeCloseTo(2 * (z + 3 * q), 2);
    expect(r.assumptions).toMatch(/Zone 1 billing zone/);
  });
  it("App Insights: GB ingested beyond free 5 GB + retention beyond 90 days", async () => {
    const ing = one(F.la, (i) => i.meterName === "Analytics Logs Data Ingestion" && i.retailPrice > 0);
    const ret = one(F.la, (i) => i.meterName === "Analytics Logs Data Retention");
    const r = await est({ service: "Application Insights", arm_sku: "workspace-based", gb_ingested: 20, retention_days: 120 });
    expect(r.status).toBe("OK");
    expect(r.payg_month).toBeCloseTo(15 * ing + 20 * (30 / 30) * ret, 2);
  });
  it("Monitor alerts: metric time series beyond 10 free; log alerts by frequency", async () => {
    const m = one(F.mon, (i) => i.meterName === "Alerts Metric Monitored" && i.retailPrice > 0);
    const r = await est({ service: "Azure Monitor Alerts", arm_sku: "MetricAlerts", alert_rules: 25 });
    expect(r.payg_month).toBeCloseTo(15 * m, 2);
    const l = one(F.mon, (i) => i.meterName === "Alerts System Log Monitored at 15 Minute Frequency");
    const r2 = await est({ service: "Log alerts", arm_sku: "LogAlerts", alert_rules: 4, usage: "alert_frequency_min=15" });
    expect(r2.payg_month).toBeCloseTo(4 * l, 2);
  });
  it("Entra External ID: MAU first 50k free, M2M per token", async () => {
    const mau = one(F.ext, (i) => i.meterName === "Core Monthly Active Users" && i.retailPrice > 0);
    expect((await est({ service: "Entra External ID", arm_sku: "", mau: 60000 })).payg_month).toBeCloseTo(10000 * mau, 2);
    const t = one(F.ext, (i) => i.meterName === "M2M Authentication Token");
    const r = await est({ service: "Entra External ID", arm_sku: "M2M-token", tokens: 50000 });
    expect(r.payg_month).toBeCloseTo(50000 * t, 2);
    expect(r.message).toMatch(/M2M/);
  });
  it("Managed Identity: INFO, zero, no fabricated meter", async () => {
    const r = await est({ service: "Managed Identity", arm_sku: "UserAssigned" });
    expect(r.status).toBe("INFO"); expect(r.payg_month).toBe(0); expect(r.matched_meters).toBe(""); expect(r.message).toMatch(/No direct charge/);
  });
  it("every catalogue SKU prices against the recorded meters", async () => {
    for (const e of CATALOGUE) {
      const skus = e.resolveSku ? (e.id === "storage" ? ["Standard_LRS", "Standard_RAGRS", "Cool_ZRS"] : ["B1", "S1", "P1v2", "P0v3", "P1v3", "P1mv3"]) : Object.keys(e.skus);
      for (const sku of skus) {
        const r = await priceCatalogue({ service: e.aliases[0], arm_sku: sku, name: e.label }, "uksouth", 730, "", "GBP");
        expect(r?.status, `${e.label} ${sku}: ${r?.error}`).not.toBe("ERROR");
      }
    }
  });
  it("Windows App Service uses the Windows plan meter", async () => {
    const lin = await est({ service: "App Service", arm_sku: "P1v3", os: "Linux" });
    const win = await est({ service: "App Service", arm_sku: "P1v3", os: "Windows" });
    expect(win.payg_month!).toBeGreaterThan(lin.payg_month!);
    expect(win.matched_meters).toMatch(/Premium v3 Plan \/ P1 v3/);
  });
  it("unmatched meter -> ERROR with candidate meters", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ Items: [
      { type: "Consumption", productName: "Azure DNS", skuName: "Private", meterName: "Private Zone", unitOfMeasure: "1", retailPrice: 0.37, tierMinimumUnits: 0 },
    ], NextPageLink: null }))));
    const r = await est({ service: "Private DNS Zone", arm_sku: "PrivateDNSZone", region: "brazilsouth" });
    expect(r.status).toBe("ERROR");
    expect(r.message).toMatch(/No retail meter found.*Private Queries.*Candidates: Private \/ Private Zone/);
    expect(r.payg_month).toBeNull();
  });
});
