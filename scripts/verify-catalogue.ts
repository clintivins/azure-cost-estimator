/**
 * Verifies every catalogue mapping against the live Azure Retail Prices API and records the exact meters matched.
 * Usage: npm run verify:catalogue [-- region currency]   (default uksouth GBP)
 * Writes docs/catalogue-verification.md and docs/catalogue-verification.json. Exits 1 if any mapping fails.
 */
import { writeFileSync } from "fs";
import { CATALOGUE, priceCatalogue } from "../lib/catalogue";

const region = process.argv[2] ?? "uksouth";
const currency = process.argv[3] ?? "GBP";

async function main() {
  const rows: any[] = [];
  let failed = 0;
  for (const e of CATALOGUE) {
    const skus = e.resolveSku ? (e.id === "storage" ? ["Standard_LRS", "Standard_ZRS", "Standard_GRS", "Standard_RAGRS", "Standard_GZRS", "Cool_LRS", "Cold_ZRS"] : ["B1", "S1", "P1v2", "P0v3", "P1v3", "P3v3", "P1mv3"]) : Object.keys(e.skus);
    for (const sku of skus) {
      const row = { service: e.aliases[0], arm_sku: sku, region, name: e.label };
      const r = await priceCatalogue(row, region, 730, "", currency);
      if (!r) { failed++; rows.push({ service: e.label, sku, status: "UNRESOLVED" }); continue; }
      if (r.status === "ERROR") failed++;
      rows.push({ service: e.label, sku, status: r.status, monthly: r.monthly, error: r.error, components: r.components, assumptions: r.assumptions, notes: r.notes });
      console.log(`${r.status.padEnd(5)} ${e.label} ${sku}: ${r.monthly == null ? "-" : r.monthly.toFixed(2)} ${r.error ?? ""}`);
    }
  }
  const at = new Date().toISOString();
  writeFileSync("docs/catalogue-verification.json", JSON.stringify({ generated_at: at, region, currency, rows }, null, 2));
  const md = [
    `# Catalogue verification`, ``,
    `Generated ${at} against the live Azure Retail Prices API (region \`${region}\`, currency ${currency}, api-version 2023-01-01-preview).`,
    `Each line is priced with its default usage assumptions; prices are the retail meters matched, not hard-coded values.`, ``,
    `| Service | SKU | Status | Component | Product / SKU / Meter | Unit | Unit price | Qty | Monthly |`,
    `|---|---|---|---|---|---|---:|---:|---:|`,
    ...rows.flatMap((r) => (r.components?.length ? r.components : [null]).map((c: any) =>
      `| ${r.service} | ${r.sku} | ${r.status} | ${c?.label ?? "-"} | ${c ? `${c.product} / ${c.sku} / ${c.meter}` : (r.error ?? (r.notes ?? []).join(" ")).replace(/\|/g, "/")} | ${c?.unit ?? ""} | ${c?.unit_price ?? ""} | ${c?.quantity ?? ""} | ${c ? c.monthly.toFixed(2) : ""} |`)),
    ``,
  ].join("\n");
  writeFileSync("docs/catalogue-verification.md", md);
  console.log(`\n${rows.length} mappings, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
