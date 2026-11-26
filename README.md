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
| name | free text (also used to recognise the service when `service` is blank or `Other`) |
| service | `VM` \| `AKS` \| `Disk`, or a service name from the catalogue below (e.g. `API Management`, `Storage Account`, `Private Endpoint`). `Other` = catalogue lookup by SKU/name, then a best-effort generic match |
| arm_sku | deployment SKU, e.g. `Standard_D4s_v5`, `P10`, `Standard_v2`, `Standard_LRS`, `PrivateEndpoint`, `PrivateDNSZone`, `workspace-based`, `MetricAlerts`, `M2M-token`, `UserAssigned` |
| region | ARM region, e.g. `uksouth` |
| quantity | number of identical resources (VMs, AKS nodes, APIM units, endpoints, DNS zones, plan instances, Service Bus MUs...) |
| hours_per_month | default 730; only applied to hourly meters |
| os | `Linux` \| `Windows` – VMs and App Service plans only |
| pricing | `PAYG` \| `RI1Y` \| `RI3Y` \| `SP1Y` \| `SP3Y` \| `Spot` (VM/AKS; everything else is PAYG) |
| ahb | `yes`/`no` – Azure Hybrid Benefit, uses the Linux compute meter |
| aks_tier | `Free` \| `Standard` \| `Premium` (AKS rows) |
| usage columns | `gb_stored`, `write_10k`, `read_10k`, `gb_processed`, `queries_million`, `gb_ingested`, `retention_days`, `alert_rules`, `calls_million`, `mau`, `tokens` – blank = documented default, stated per line in `assumptions` |
| usage | any other driver as `key=value` pairs, e.g. `messages_million=20; ops_10k=50` |
| service_name, meter | advanced generic lookup: Retail Prices `serviceName` and a meter-name substring (`meter` forces the generic lookup) |

Old templates (without usage columns) still work.

## Service-aware pricing

Deployment SKUs (`armSkuName`) are not billing meters. Each catalogue service maps friendly names and deployment SKUs to Retail Prices API filters (`serviceName`/`productName`/`skuName`/`meterName`) and a usage model. Graduated tiers (`tierMinimumUnits`, e.g. free allowances) are applied per line. Every price is read live; `npm run verify:catalogue` queries every mapping and writes the exact meters and prices to [`docs/catalogue-verification.md`](docs/catalogue-verification.md).

| Service | SKUs | Model |
|---|---|---|
| API Management | Developer, Basic, Standard, Premium, Basic v2, Standard v2, Premium v2, Consumption | units × hours; Consumption per 10K calls (first 1M free); v2 call overage via `calls_million` |
| Storage account (Blob, GPv2) | `Standard_LRS/ZRS/GRS/RAGRS/GZRS/RAGZRS`, optional Hot/Cool/Cold/Archive | GB stored (tiered) + write ops/10K + read ops/10K |
| Private Endpoint | `PrivateEndpoint` | endpoint hours + GB processed in/out |
| Azure DNS | `PrivateDNSZone`, public zones | per hosted zone + queries per million (billing Zone 1 for Europe/NA) |
| Log Analytics / App Insights | `workspace-based`, `PerGB2018` | GB ingested (first 5 GB free) + retention beyond 31 days (90 for App Insights) |
| Azure Monitor alerts | `MetricAlerts`, `LogAlerts` | metric time series monitored (first 10 free); log alert rules by frequency |
| Entra External ID | Core / Basic MAU, `M2M-token` | MAU (first 50,000 free); M2M per token |
| Managed Identity | `UserAssigned`, `SystemAssigned` | INFO, £0 – no direct charge |
| Functions | Consumption, Flex, EP1–EP3 | executions + GB-seconds (free grant); EPn = vCPU + memory hours |
| Logic Apps | WS1–WS3, Consumption | Standard = vCPU + memory hours; Consumption = actions |
| Service Bus | Basic, Standard, Premium | operations; Standard base + operations (13M included); Premium MUs × hours |
| Key Vault | Standard, Premium | operations per 10K (+ HSM keys) |
| App Service plan | B1–B3, S1–S3, P1v2–P3v2, P0v3–P3v3, P1mv3+ | instances × hours, Linux/Windows |
| Azure Front Door | Standard, Premium | base fee + requests + GB out |
| Application Gateway | Standard_v2, WAF_v2, Basic_v2 | fixed hourly + capacity units |
| Event Grid | Basic topics, Namespaces | operations (first 100K free); throughput units + event operations |
| Cosmos DB (NoSQL) | Provisioned, Serverless | RU/s × hours or RUs + GB stored |

Each result line has `status` (OK = all usage given, WARN = defaults assumed or a fallback, INFO = no direct charge, ERROR = not priced), `matched_meters`, `unit_price`, `usage` (billable quantity per meter), `assumptions`, monthly/yearly cost and a `components` breakdown. A SKU or meter that can't be matched returns ERROR with the candidate meters the API offers – prices are never invented. ERROR rows are excluded from totals.

## Pricing rules (VM / AKS / Disk / generic)

- VM meters: `serviceName eq 'Virtual Machines'` + `armSkuName` + `armRegionName`; `Low Priority` and `DevTestConsumption` excluded; Spot = `meterName` contains "Spot"; Windows = `productName` contains "Windows".
- Reservations: `type eq 'Reservation'` + `reservationTerm`; monthly equivalent = price / 12 or / 36 (fixed, not scaled by hours).
- Savings plan: `savingsPlan` array on Linux consumption items (`api-version=2023-01-01-preview`).
- Windows RI/SP = Linux compute rate + Windows licence (Windows PAYG − Linux PAYG) per hour, unless AHB.
- AKS: node VM cost × nodes + cluster fee from `serviceName 'Azure Kubernetes Service'`: Free = 0, Standard = "Standard Uptime SLA", Premium = "Standard Uptime SLA" + "Standard Long Term Support" (per cluster-hour × hours_per_month). Tier fee is not reservation-discounted.
- Disks: `serviceName 'Storage'`, product contains "Managed Disks", `skuName 'P10 LRS'`, meter "… Disk", unit `1/Month`. Only PAYG (other options fall back with WARN).
- Other (not in the catalogue): best-effort match on `armSkuName`/`skuName` in region, narrowed by `service_name` and `meter` when given; billable hourly/monthly capacity meters are preferred over add-on meters (always WARN, verify). A `service` value that is not VM/AKS/Disk/Other (e.g. `API Management`) is treated as Other with that service name. Region `global` is allowed for Other rows.
- Validation: missing fields, unknown service/pricing, unknown region, SKU not found → ERROR; option not offered → WARN and PAYG fallback.
- Discount % is applied to every option. Lookups are cached in memory (6h) and deduped; 429/5xx/timeouts retried with capped backoff (10 s per call, max 4 concurrent calls per instance); a 45 s overall deadline returns unfinished rows as ERROR so the API always answers with JSON; responses send `Cache-Control`.

## REST

```bash
curl -s https://azure-cost-estimator-three.vercel.app/api/estimate -H 'content-type: application/json' -d '{
  "currency":"GBP","discount_pct":0,
  "rows":[{"name":"web","service":"VM","arm_sku":"Standard_D4s_v5","region":"uksouth","quantity":2,"os":"Linux","pricing":"RI3Y"},
          {"name":"blob","service":"Storage Account","arm_sku":"Standard_LRS","region":"uksouth","gb_stored":500,"usage":"write_10k=20; read_10k=200"}]
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
npm run verify:catalogue   # live check of every catalogue mapping -> docs/catalogue-verification.md
npm run record:fixture     # refresh the offline test fixture (uksouth, GBP)
```

## Limitations

Retail list prices only (no EA/MCA/CSP rates beyond the flat discount), no tax, bandwidth, support, licensing other than Windows Server, or disk transactions. Premium SSD v2 / Ultra disks are not priced. Free allowances (e.g. first 5 GB Log Analytics, first 10 alert time series, first 50,000 MAU) are per subscription or billing account in reality but applied per line here. Usage defaults are placeholders – replace them with your own figures. Estimates – always verify with the Azure pricing calculator.
