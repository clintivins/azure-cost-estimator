import { describe, it, expect, vi, afterEach } from "vitest";
import { selectOtherMeter } from "@/lib/pricing";
import { estimateRows } from "@/lib/estimate";
import { POST } from "@/app/api/estimate/route";

const item = (o: any) => ({ currencyCode: "GBP", unitPrice: o.retailPrice, armRegionName: "uksouth", armSkuName: "", serviceName: "X", productName: "X", skuName: "Standard v2", type: "Consumption", unitOfMeasure: "1 Hour", ...o });
const ok = (items: any[]) => new Response(JSON.stringify({ Items: items, NextPageLink: null }), { headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Other meter selection", () => {
  const items = [
    item({ meterName: "Standard v2 Calls", unitOfMeasure: "10K", retailPrice: 0 }),
    item({ meterName: "Standard v2 Self-hosted Gateway", retailPrice: 0.257 }),
    item({ meterName: "Standard v2 Unit", retailPrice: 0.721 }),
    item({ meterName: "Standard v2 Secondary Unit", retailPrice: 0.515 }),
  ];
  it("prefers the billable capacity meter over add-ons and zero-price meters", () => {
    expect(selectOtherMeter(items as any)?.meterName).toBe("Standard v2 Unit");
  });
  it("honours an explicit meter filter", () => {
    expect(selectOtherMeter(items as any, "self-hosted")?.meterName).toBe("Standard v2 Self-hosted Gateway");
    expect(selectOtherMeter(items as any, "nope")).toBeUndefined();
  });
});

describe("estimateRows resilience", () => {
  it("treats an uncatalogued service name as Other and filters on serviceName", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { urls.push(new URL(u).searchParams.get("$filter") ?? ""); return ok([item({ serviceName: "SignalR", meterName: "Standard v2 Unit", retailPrice: 1 })]); }));
    const r = await estimateRows([{ name: "sig", service: "SignalR", arm_sku: "Standard v2", region: "UK South", quantity: 2 }], "GBP", 0, 6, 5_000);
    expect(r.rows[0].status).toBe("WARN");
    expect(r.rows[0].payg_month).toBe(1460);
    expect(urls.some((u) => u.includes("serviceName eq 'SignalR'"))).toBe(true);
  });

  it("returns per-row ERRORs instead of hanging when the prices API never answers", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: any) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal.reason)))));
    const t0 = Date.now();
    const rows = Array.from({ length: 11 }, (_, i) => ({ name: `r${i}`, service: "VM", arm_sku: `Standard_Hang_${i}`, region: "uksouth" }));
    const r = await estimateRows(rows, "GBP", 0, 6, 300);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r.rows).toHaveLength(11);
    expect(r.rows.every((x) => x.status === "ERROR" && /timed out/i.test(x.message))).toBe(true);
    expect(r.warning).toMatch(/11 row\(s\) timed out/);
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it("caps a long Retry-After on 429 and reports the row as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429, headers: { "retry-after": "120" } })));
    const t0 = Date.now();
    const r = await estimateRows([{ service: "Other", arm_sku: "Throttled", region: "uksouth" }], "GBP", 0, 6, 30_000);
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.rows[0].status).toBe("ERROR");
    expect(r.rows[0].message).toMatch(/429/);
  }, 25_000);

  it("survives malformed rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([])));
    const r = await estimateRows([null as any, "x" as any, {}], "GBP");
    expect(r.rows.map((x) => x.status)).toEqual(["ERROR", "ERROR", "ERROR"]);
  });
});

describe("/api/estimate always answers JSON", () => {
  const post = (body: string) => POST(new Request("http://x/api/estimate", { method: "POST", body, headers: { "content-type": "application/json" } }));
  it("bad JSON body", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect((await res.json()).error).toBeTruthy();
  });
  it("valid request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([])));
    const res = await post(JSON.stringify({ rows: [{ service: "Other", arm_sku: "Nothing", region: "uksouth" }] }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.rows[0].status).toBe("ERROR");
  });
});

describe("Other ambiguity", () => {
  it("refuses to guess when a bare SKU matches several services", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([
      item({ serviceName: "Key Vault", productName: "Key Vault", meterName: "Operations", unitOfMeasure: "10K", retailPrice: 0.02 }),
      item({ serviceName: "Container Instances", productName: "Container Instances", meterName: "Standard Windows Software Duration", unitOfMeasure: "1 Second", retailPrice: 0.00001 }),
    ])));
    const r = await estimateRows([{ service: "Other", arm_sku: "StandardAmbiguous", region: "uksouth" }], "GBP", 0, 6, 5_000);
    expect(r.rows[0].status).toBe("ERROR");
    expect(r.rows[0].message).toMatch(/matches 2 services.*service_name/);
  });
  it("with service_name, prefers the cheaper of equally scored meters over a dedicated HSM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([
      item({ serviceName: "Key Vault HSMish", productName: "Azure Dedicated HSM", meterName: "Standard Instance", retailPrice: 3.6 }),
      item({ serviceName: "Key Vault HSMish", productName: "Key Vault HSMish", meterName: "Operations", unitOfMeasure: "10K", retailPrice: 0.02 }),
    ])));
    const r = await estimateRows([{ service: "Other", service_name: "Key Vault HSMish", arm_sku: "StandardKV", region: "uksouth" }], "GBP", 0, 6, 5_000);
    expect(r.rows[0].message).toMatch(/Key Vault HSMish \/ Operations/);
  });
});
