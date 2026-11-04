# Azure Cost Estimator

Public, read-only Azure cost estimator built on Next.js (App Router) and deployed on Vercel. Prices come live from the public [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices). No Azure account needed.

**Live:** https://azure-cost-estimator-three.vercel.app · MCP: `https://azure-cost-estimator-three.vercel.app/api/mcp`

- **Web UI** (`/`): drag-and-drop `.xlsx`/`.csv` BOM, discount %, currency (GBP default, USD/EUR), per-row results with PAYG / Spot / RI 1Y / RI 3Y / Savings Plan 1Y / 3Y, chosen option month/year, saving vs PAYG, totals, export to `.xlsx`.
- **Template**: `/template.xlsx` (blank) and `/sample.xlsx` (example rows).
- **REST API**: `POST /api/estimate`
- **MCP server**: `/api/mcp` (Streamable HTTP, via `mcp-handler`)

## Template columns

| column | values |
|---|---|
| name | free text |
| service | `VM` \| `AKS` \| `Disk` \| `Other` |
| arm_sku | e.g. `Standard_D4s_v5`; disks `P10`, `E10`, `S10` (LRS assumed, add ` ZRS` for ZRS); AKS = node VM size |
| region | ARM region, e.g. `uksouth` |
| quantity | count (AKS: node count) |
| hours_per_month | default 730 |
| os | `Linux` \| `Windows` |
| pricing | `PAYG` \| `RI1Y` \| `RI3Y` \| `SP1Y` \| `SP3Y` \| `Spot` |
| ahb | `yes`/`no` – Azure Hybrid Benefit, uses the Linux compute meter |
| aks_tier | `Free` \| `Standard` \| `Premium` (AKS rows) |

## Pricing rules

- VM meters: `serviceName eq 'Virtual Machines'` + `armSkuName` + `armRegionName`; `Low Priority` and `DevTestConsumption` excluded; Spot = `meterName` contains "Spot"; Windows = `productName` contains "Windows".
- Reservations: `type eq 'Reservation'` + `reservationTerm`; monthly equivalent = price / 12 or / 36 (fixed, not scaled by hours).
- Savings plan: `savingsPlan` array on Linux consumption items (`api-version=2023-01-01-preview`).
- Windows RI/SP = Linux compute rate + Windows licence (Windows PAYG − Linux PAYG) per hour, unless AHB.
- AKS: node VM cost × nodes + cluster fee from `serviceName 'Azure Kubernetes Service'`: Free = 0, Standard = "Standard Uptime SLA", Premium = "Standard Uptime SLA" + "Standard Long Term Support" (per cluster-hour × hours_per_month). Tier fee is not reservation-discounted.
- Disks: `serviceName 'Storage'`, product contains "Managed Disks", `skuName 'P10 LRS'`, meter "… Disk", unit `1/Month`. Only PAYG (other options fall back with WARN).
- Other: best-effort match on `armSkuName`/`skuName` in region (always WARN, verify).
- Validation: missing fields, unknown service/pricing, unknown region, SKU not found → ERROR; option not offered → WARN and PAYG fallback.
- Discount % is applied to every option. Lookups are cached in memory (6h) and deduped; 429/5xx retried with backoff; responses send `Cache-Control`.

## REST

```bash
curl -s https://azure-cost-estimator-three.vercel.app/api/estimate -H 'content-type: application/json' -d '{
  "currency":"GBP","discount_pct":0,
  "rows":[{"name":"web","service":"VM","arm_sku":"Standard_D4s_v5","region":"uksouth","quantity":2,"os":"Linux","pricing":"RI3Y"}]
}'
```

## MCP

Tools: `price_sku(sku, region, os, currency)`, `estimate_aks(node_sku, nodes, region, tier, pricing, currency)`, `estimate_bom(rows[], discount_pct, currency)`. Read-only, no auth (public price data).

Cursor (`~/.cursor/mcp.json`) or VS Code (`.vscode/mcp.json`, use `"servers"` instead of `"mcpServers"`):

```json
{
  "mcpServers": {
    "azure-cost-estimator": { "url": "https://azure-cost-estimator-three.vercel.app/api/mcp" }
  }
}
```

Clients that only support stdio: `npx mcp-remote https://azure-cost-estimator-three.vercel.app/api/mcp`.

## Develop

```bash
npm install && npm test && npm run dev
```

## Limitations

Retail list prices only (no EA/MCA/CSP rates beyond the flat discount), no tax, bandwidth, support, licensing other than Windows Server, or disk transactions. Premium SSD v2 / Ultra disks are not priced. Estimates – always verify with the Azure pricing calculator.
