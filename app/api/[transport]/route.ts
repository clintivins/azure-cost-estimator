import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getVmRates } from "@/lib/pricing";
import { estimateRow, estimateRows, vmOptions } from "@/lib/estimate";

const currency = z.enum(["GBP", "USD", "EUR"]).default("GBP");
const pricing = z.enum(["PAYG", "RI1Y", "RI3Y", "SP1Y", "SP3Y", "Spot"]).default("PAYG");
const text = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }] });

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "price_sku",
      "Hourly and 730h-monthly Azure VM prices (PAYG, Spot, RI 1Y/3Y, Savings Plan 1Y/3Y) for one ARM SKU in a region, from the public Azure Retail Prices API.",
      { sku: z.string().describe("ARM SKU e.g. Standard_D4s_v5"), region: z.string().describe("e.g. uksouth"), os: z.enum(["Linux", "Windows"]).default("Linux"), currency },
      { readOnlyHint: true, openWorldHint: true },
      async ({ sku, region, os, currency }) => {
        const r = await getVmRates(sku, region, currency);
        if (r.linuxPayg == null && r.windowsPayg == null) return { ...text({ error: `SKU '${sku}' not found in ${region}` }), isError: true };
        const m = Object.fromEntries(Object.entries(vmOptions(r, 1, 730, os === "Windows")).map(([k, v]) => [k, Math.round((v as number) * 100) / 100]));
        return text({ sku, region, os, currency, hourly: r, monthly_730h: m });
      },
    );
    server.tool(
      "estimate_aks",
      "Monthly estimate for an AKS cluster: node VM cost x nodes plus the cluster tier fee (Free=0, Standard=Uptime SLA, Premium=Uptime SLA+LTS).",
      { node_sku: z.string(), nodes: z.number().int().positive(), region: z.string(), tier: z.enum(["Free", "Standard", "Premium"]).default("Free"), pricing, currency, hours_per_month: z.number().min(0).max(744).default(730) },
      { readOnlyHint: true, openWorldHint: true },
      async (a) => text(await estimateRow({ name: "aks", service: "AKS", arm_sku: a.node_sku, quantity: a.nodes, region: a.region, aks_tier: a.tier, pricing: a.pricing, hours_per_month: a.hours_per_month }, a.currency)),
    );
    server.tool(
      "estimate_bom",
      "Estimate a bill of materials. Each row: name, service (VM|AKS|Disk|Other), arm_sku, region, quantity, hours_per_month, os, pricing, ahb, aks_tier. Max 200 rows.",
      {
        rows: z.array(z.object({
          name: z.string().optional(), service: z.string(), arm_sku: z.string(), region: z.string(),
          quantity: z.number().optional(), hours_per_month: z.number().optional(), os: z.string().optional(),
          pricing: z.string().optional(), ahb: z.union([z.string(), z.boolean()]).optional(), aks_tier: z.string().optional(),
        })).min(1).max(200),
        discount_pct: z.number().min(0).max(100).default(0),
        currency,
      },
      { readOnlyHint: true, openWorldHint: true },
      async ({ rows, discount_pct, currency }) => text(await estimateRows(rows, currency, discount_pct)),
    );
  },
  { serverInfo: { name: "azure-cost-estimator", version: "0.1.0" } },
  { basePath: "/api", maxDuration: 60, verboseLogs: false },
);
export { handler as GET, handler as POST, handler as DELETE };
