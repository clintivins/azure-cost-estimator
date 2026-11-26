import * as XLSX from "xlsx";
import { DRIVERS, SUPPORTED } from "./catalogue";

export const COLUMNS = [
  "name", "service", "arm_sku", "region", "quantity", "hours_per_month", "os", "pricing", "ahb", "aks_tier",
  "gb_stored", "write_10k", "read_10k", "gb_processed", "queries_million", "gb_ingested", "retention_days",
  "alert_rules", "calls_million", "mau", "tokens", "usage", "service_name", "meter",
];
const r = (o: Record<string, unknown>) => ({ hours_per_month: 730, quantity: 1, pricing: "PAYG", ...o });
export const SAMPLE_ROWS = [
  r({ name: "web-vm", service: "VM", arm_sku: "Standard_D4s_v5", region: "uksouth", quantity: 2, os: "Linux", pricing: "RI3Y", ahb: "no" }),
  r({ name: "app-win", service: "VM", arm_sku: "Standard_D2s_v5", region: "uksouth", os: "Windows", pricing: "SP1Y", ahb: "no" }),
  r({ name: "aks-cluster", service: "AKS", arm_sku: "Standard_D4s_v5", region: "uksouth", quantity: 3, os: "Linux", aks_tier: "Standard" }),
  r({ name: "data-disk", service: "Disk", arm_sku: "P10", region: "uksouth", quantity: 2 }),
  r({ name: "api-gateway", service: "API Management", arm_sku: "Standard_v2", region: "uksouth" }),
  r({ name: "blob-store", service: "Storage", arm_sku: "Standard_LRS", region: "uksouth", gb_stored: 500, write_10k: 20, read_10k: 200 }),
  r({ name: "pe-blob", service: "Private Endpoint", arm_sku: "PrivateEndpoint", region: "uksouth", gb_processed: 50 }),
  r({ name: "dns-blob", service: "Private DNS Zone", arm_sku: "PrivateDNSZone", region: "uksouth", queries_million: 1 }),
  r({ name: "app-insights", service: "Application Insights", arm_sku: "workspace-based", region: "uksouth", gb_ingested: 20, retention_days: 90 }),
  r({ name: "func", service: "Functions", arm_sku: "EP1", region: "uksouth" }),
  r({ name: "bus", service: "Service Bus", arm_sku: "Standard", region: "uksouth", usage: "messages_million=20" }),
  r({ name: "identity", service: "Managed Identity", arm_sku: "UserAssigned", region: "uksouth" }),
];

export function workbook(rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: COLUMNS }), "BOM");
  const help = [
    { column: "name", values: "free text (also used to recognise the service when 'service' is blank or Other)" },
    { column: "service", values: "VM | AKS | Disk, or a service name such as API Management, Storage, Private Endpoint, Private DNS Zone, Application Insights, Azure Monitor Alerts, Entra External ID, Managed Identity, Functions, Logic Apps, Service Bus, Key Vault, App Service, Front Door, Application Gateway, Event Grid, Cosmos DB (see Services sheet). 'Other' = best-effort generic match" },
    { column: "arm_sku", values: "deployment SKU, e.g. Standard_D4s_v5, P10, Standard_v2, Standard_LRS, PrivateEndpoint, PrivateDNSZone, workspace-based, MetricAlerts, M2M-token, UserAssigned, EP1, WS1, P1v3" },
    { column: "region", values: "ARM region name e.g. uksouth, westeurope, eastus" },
    { column: "quantity", values: "number of identical resources (VM count, AKS nodes, APIM units, endpoints, DNS zones, plan instances, Service Bus MUs...)" },
    { column: "hours_per_month", values: "default 730; only used for hourly meters (compute, APIM units, endpoints, plans)" },
    { column: "os", values: "Linux | Windows: VMs and App Service plans only" },
    { column: "pricing", values: "PAYG | RI1Y | RI3Y | SP1Y | SP3Y | Spot (VM/AKS; other services are PAYG)" },
    { column: "ahb", values: "yes/no - Azure Hybrid Benefit (uses Linux compute meter)" },
    { column: "aks_tier", values: "Free | Standard | Premium (AKS rows only)" },
    { column: "usage columns", values: "gb_stored, write_10k, read_10k, gb_processed, queries_million, gb_ingested, retention_days, alert_rules, calls_million, mau, tokens: blank = documented default, stated in the result's assumptions (see Usage sheet)" },
    { column: "usage", values: "any other driver as key=value pairs, e.g. 'messages_million=20; ops_10k=50'" },
    { column: "service_name / meter", values: "advanced: generic lookup by Retail Prices serviceName and meter-name substring (meter forces the generic lookup)" },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(help), "Help");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(DRIVERS), "Usage");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(SUPPORTED()), "Services");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
