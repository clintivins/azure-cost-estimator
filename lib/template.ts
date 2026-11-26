import * as XLSX from "xlsx";
export const COLUMNS = ["name", "service", "arm_sku", "region", "quantity", "hours_per_month", "os", "pricing", "ahb", "aks_tier", "service_name", "meter"];
export const SAMPLE_ROWS = [
  { name: "web-vm", service: "VM", arm_sku: "Standard_D4s_v5", region: "uksouth", quantity: 2, hours_per_month: 730, os: "Linux", pricing: "RI3Y", ahb: "no", aks_tier: "" },
  { name: "app-win", service: "VM", arm_sku: "Standard_D2s_v5", region: "uksouth", quantity: 1, hours_per_month: 730, os: "Windows", pricing: "SP1Y", ahb: "no", aks_tier: "" },
  { name: "aks-cluster", service: "AKS", arm_sku: "Standard_D4s_v5", region: "uksouth", quantity: 3, hours_per_month: 730, os: "Linux", pricing: "PAYG", ahb: "no", aks_tier: "Standard" },
  { name: "data-disk", service: "Disk", arm_sku: "P10", region: "uksouth", quantity: 2, hours_per_month: 730, os: "", pricing: "PAYG", ahb: "", aks_tier: "" },
  { name: "api-gateway", service: "Other", arm_sku: "Standard v2", region: "uksouth", quantity: 1, hours_per_month: 730, os: "", pricing: "PAYG", ahb: "", aks_tier: "", service_name: "API Management", meter: "Unit" },
];
export function workbook(rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: COLUMNS }), "BOM");
  const help = [
    { column: "service", values: "VM | AKS | Disk | Other (or an Azure service name, e.g. API Management, priced as Other)" },
    { column: "arm_sku", values: "e.g. Standard_D4s_v5; disks e.g. P10, E10, S10; AKS = node VM size" },
    { column: "region", values: "ARM region name e.g. uksouth, westeurope, eastus" },
    { column: "quantity", values: "Instance count (AKS: node count)" },
    { column: "hours_per_month", values: "Default 730" },
    { column: "os", values: "Linux | Windows" },
    { column: "pricing", values: "PAYG | RI1Y | RI3Y | SP1Y | SP3Y | Spot" },
    { column: "ahb", values: "yes/no - Azure Hybrid Benefit (uses Linux compute meter)" },
    { column: "aks_tier", values: "Free | Standard | Premium (AKS rows only)" },
    { column: "service_name", values: "Other rows: Azure service name to narrow the match, e.g. API Management, Service Bus, Key Vault (optional)" },
    { column: "meter", values: "Other rows: part of the meter name to pick, e.g. Unit, Messaging Unit (optional)" },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(help), "Help");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
