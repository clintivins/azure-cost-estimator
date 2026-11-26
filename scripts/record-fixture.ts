/** Records live Retail Prices responses used by the catalogue (uksouth, GBP) into test/fixtures for offline tests. */
import { writeFileSync } from "fs";
import { CATALOGUE, billingZone } from "../lib/catalogue";
import { queryPrices } from "../lib/azure";

async function main() {
  const out: Record<string, unknown[]> = {};
  for (const e of CATALOGUE) {
    const f = e.filter(e.region === "global" ? "Global" : e.region === "zone" ? billingZone("uksouth") : "uksouth");
    if (!f || out[f]) continue;
    const items = await queryPrices(f, "GBP");
    out[f] = items.filter((i) => i.type === "Consumption").map(({ currencyCode, retailPrice, unitPrice, armRegionName, armSkuName, productName, skuName, meterName, serviceName, unitOfMeasure, type, ...rest }) =>
      ({ currencyCode, retailPrice, unitPrice, armRegionName, armSkuName, productName, skuName, meterName, serviceName, unitOfMeasure, type, tierMinimumUnits: (rest as any).tierMinimumUnits ?? 0 }));
  }
  writeFileSync("test/fixtures/prices-uksouth-gbp.json", JSON.stringify({ recorded_at: new Date().toISOString(), filters: out }));
  console.log(Object.entries(out).map(([k, v]) => `${v.length}\t${k}`).join("\n"));
}
main();
