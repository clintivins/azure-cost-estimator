# Catalogue verification

Generated 2026-11-26T11:47:05.738Z against the live Azure Retail Prices API (region `uksouth`, currency GBP, api-version 2023-01-01-preview).
Each line is priced with its default usage assumptions; prices are the retail meters matched, not hard-coded values.

| Service | SKU | Status | Component | Product / SKU / Meter | Unit | Unit price | Qty | Monthly |
|---|---|---|---|---|---|---:|---:|---:|
| API Management | Developer | OK | Units | API Management / Developer / Developer Unit | 1 Hour | 0.049472 | 730 | 36.11 |
| API Management | Basic | OK | Units | API Management / Basic / Basic Unit | 1 Hour | 0.151573 | 730 | 110.65 |
| API Management | Standard | OK | Units | API Management / Standard / Standard Unit | 1 Hour | 0.707267 | 730 | 516.30 |
| API Management | Premium | OK | Units | API Management / Premium / Premium Unit | 1 Hour | 2.878839 | 730 | 2101.55 |
| API Management | Basic v2 | OK | Units | API Management / Basic v2 / Basic v2 Unit | 1 Hour | 0.15449 | 730 | 112.78 |
| API Management | Standard v2 | OK | Units | API Management / Standard v2 / Standard v2 Unit | 1 Hour | 0.72095 | 730 | 526.29 |
| API Management | Premium v2 | OK | Units | API Management / Premium v2 / Premium v2 Unit | 1 Hour | 2.883816 | 730 | 2105.19 |
| API Management | Consumption | WARN | Calls | API Management / Consumption / Consumption Calls | 10K | 0.026315 | 100 | 0.00 |
| Storage account (Blob) | Standard_LRS | WARN | Data stored | General Block Blob v2 / Hot LRS / Hot LRS Data Stored | 1 GB/Month | 0.014436 | 100 | 1.44 |
| Storage account (Blob) | Standard_LRS | WARN | Write operations | General Block Blob v2 / Hot LRS / Hot LRS Write Operations | 10K | 0.044359 | 10 | 0.44 |
| Storage account (Blob) | Standard_LRS | WARN | Read operations | General Block Blob v2 / Hot LRS / Hot Read Operations | 10K | 0.003534 | 100 | 0.35 |
| Storage account (Blob) | Standard_ZRS | WARN | Data stored | General Block Blob v2 / Hot ZRS / Hot ZRS Data Stored | 1 GB/Month | 0.018044 | 100 | 1.80 |
| Storage account (Blob) | Standard_ZRS | WARN | Write operations | General Block Blob v2 / Hot ZRS / Hot ZRS Write Operations | 10K | 0.055449 | 10 | 0.55 |
| Storage account (Blob) | Standard_ZRS | WARN | Read operations | General Block Blob v2 / Hot ZRS / Hot ZRS Read Operations | 10K | 0.003534 | 100 | 0.35 |
| Storage account (Blob) | Standard_GRS | WARN | Data stored | General Block Blob v2 / Hot GRS / Hot GRS Data Stored | 1 GB/Month | 0.028871 | 100 | 2.89 |
| Storage account (Blob) | Standard_GRS | WARN | Write operations | General Block Blob v2 / Hot GRS / Hot GRS Write Operations | 10K | 0.08947 | 10 | 0.89 |
| Storage account (Blob) | Standard_GRS | WARN | Read operations | General Block Blob v2 / Hot GRS / Hot Read Operations | 10K | 0.003534 | 100 | 0.35 |
| Storage account (Blob) | Standard_RAGRS | WARN | Data stored | General Block Blob v2 / Hot RA-GRS / Hot RA-GRS Data Stored | 1 GB/Month | 0.036089 | 100 | 3.61 |
| Storage account (Blob) | Standard_RAGRS | WARN | Write operations | General Block Blob v2 / Hot RA-GRS / Hot GRS Write Operations | 10K | 0.08947 | 10 | 0.89 |
| Storage account (Blob) | Standard_RAGRS | WARN | Read operations | General Block Blob v2 / Hot RA-GRS / Hot Read Operations | 10K | 0.003534 | 100 | 0.35 |
| Storage account (Blob) | Standard_GZRS | WARN | Data stored | General Block Blob v2 / Hot GZRS / Hot GZRS Data Stored | 1 GB/Month | 0.03248 | 100 | 3.25 |
| Storage account (Blob) | Standard_GZRS | WARN | Write operations | General Block Blob v2 / Hot GZRS / Hot GZRS Write Operations | 10K | 0.099996 | 10 | 1.00 |
| Storage account (Blob) | Standard_GZRS | WARN | Read operations | General Block Blob v2 / Hot GZRS / Hot ZRS Read Operations | 10K | 0.003534 | 100 | 0.35 |
| Storage account (Blob) | Cool_LRS | WARN | Data stored | General Block Blob v2 / Cool LRS / Cool LRS Data Stored | 1 GB/Month | 0.007894 | 100 | 0.79 |
| Storage account (Blob) | Cool_LRS | WARN | Write operations | General Block Blob v2 / Cool LRS / Cool LRS Write Operations | 10K | 0.082704 | 10 | 0.83 |
| Storage account (Blob) | Cool_LRS | WARN | Read operations | General Block Blob v2 / Cool LRS / Cool Read Operations | 10K | 0.00827 | 100 | 0.83 |
| Storage account (Blob) | Cold_ZRS | WARN | Data stored | General Block Blob v2 / Cold ZRS / Cold ZRS Data Stored | 1 GB/Month | 0.003759 | 100 | 0.38 |
| Storage account (Blob) | Cold_ZRS | WARN | Write operations | General Block Blob v2 / Cold ZRS / Cold ZRS Write Operations | 10K | 0.15037 | 10 | 1.50 |
| Storage account (Blob) | Cold_ZRS | WARN | Read operations | General Block Blob v2 / Cold ZRS / Cold ZRS Read Operations | 10K | 0.075185 | 100 | 7.52 |
| Private Endpoint | Standard | WARN | Endpoint hours | Virtual Network Private Link / Standard / Standard Private Endpoint | 1 Hour | 0.007519 | 730 | 5.49 |
| Private Endpoint | Standard | WARN | Data processed in | Virtual Network Private Link / Standard / Standard Data Processed - Ingress | 1 GB | 0.007519 | 5 | 0.04 |
| Private Endpoint | Standard | WARN | Data processed out | Virtual Network Private Link / Standard / Standard Data Processed - Egress | 1 GB | 0.007519 | 5 | 0.04 |
| Azure DNS | Private | WARN | Hosted zone | Azure DNS / Private / Private Zone | 1 | 0.375926 | 1 | 0.38 |
| Azure DNS | Private | WARN | Queries | Azure DNS / Private / Private Queries | 1M | 0.300741 | 1 | 0.30 |
| Azure DNS | Public | WARN | Hosted zone | Azure DNS / Public / Public Zone | 1 | 0.375926 | 1 | 0.38 |
| Azure DNS | Public | WARN | Queries | Azure DNS / Public / Public Queries | 1M | 0.300741 | 1 | 0.30 |
| Log Analytics / Application Insights | Analytics | WARN | Data ingestion | Log Analytics / Analytics Logs / Analytics Logs Data Ingestion | 1 GB | 2.165332 | 10 | 10.83 |
| Azure Monitor alerts | Metric | WARN | Metric time series monitored | Azure Monitor / Alerts / Alerts Metric Monitored | 1/Month | 0.075185 | 10 | 0.00 |
| Azure Monitor alerts | Log | WARN | Log alert rules | Azure Monitor / Alerts / Alerts System Log Monitored at 5 Minute Frequency | 1/Month | 1.127777 | 5 | 5.64 |
| Microsoft Entra External ID | Core | WARN | Monthly active users | Microsoft Entra External ID / Core / Core Monthly Active Users | 1/Month | 0.012218 | 50000 | 0.00 |
| Microsoft Entra External ID | Basic | WARN | Monthly active users | Microsoft Entra External ID / Basic / Basic Monthly Active Users | 1/Month | 0.022556 | 50000 | 0.00 |
| Microsoft Entra External ID | M2M | WARN | M2M tokens | Microsoft Entra External ID / M2M Authentication / M2M Authentication Token | 1 | 0.000752 | 10000 | 7.52 |
| Managed Identity | UserAssigned | INFO | - | No direct charge: managed identities and their Entra ID tokens are free. Costs come from the resources they access. |  |  |  |  |
| Managed Identity | SystemAssigned | INFO | - | No direct charge: managed identities and their Entra ID tokens are free. Costs come from the resources they access. |  |  |  |  |
| Azure Functions | Consumption | WARN | Executions | Functions / Standard / Standard Total Executions | 10 | 0.000002 | 100000 | 0.00 |
| Azure Functions | Consumption | WARN | Execution time | Functions / Standard / Standard Execution Time | 1 GB Second | 0.000012 | 100000 | 0.00 |
| Azure Functions | Flex | WARN | Executions | Flex Consumption / On Demand / On Demand Total Executions | 10 | 0.000003 | 100000 | 0.23 |
| Azure Functions | Flex | WARN | Execution time | Flex Consumption / On Demand / On Demand Execution Time | 1 GB Second | 0.000028 | 400000 | 8.40 |
| Azure Functions | EP1 | OK | vCPU hours | Premium Functions / Premium / Premium vCPU Duration | 1 Hour | 0.139093 | 730 | 101.54 |
| Azure Functions | EP1 | OK | Memory hours | Premium Functions / Premium / Premium Memory Duration | 1 GiB Hour | 0.009924 | 2555 | 25.36 |
| Azure Functions | EP2 | OK | vCPU hours | Premium Functions / Premium / Premium vCPU Duration | 1 Hour | 0.139093 | 1460 | 203.08 |
| Azure Functions | EP2 | OK | Memory hours | Premium Functions / Premium / Premium Memory Duration | 1 GiB Hour | 0.009924 | 5110 | 50.71 |
| Azure Functions | EP3 | OK | vCPU hours | Premium Functions / Premium / Premium vCPU Duration | 1 Hour | 0.139093 | 2920 | 406.15 |
| Azure Functions | EP3 | OK | Memory hours | Premium Functions / Premium / Premium Memory Duration | 1 GiB Hour | 0.009924 | 10220 | 101.42 |
| Logic Apps | WS1 | OK | vCPU hours | Logic Apps / Standard / Standard vCPU Duration | 1 Hour | 0.155483 | 730 | 113.50 |
| Logic Apps | WS1 | OK | Memory hours | Logic Apps / Standard / Standard Memory Duration | 1 GiB Hour | 0.011127 | 2555 | 28.43 |
| Logic Apps | WS2 | OK | vCPU hours | Logic Apps / Standard / Standard vCPU Duration | 1 Hour | 0.155483 | 1460 | 227.01 |
| Logic Apps | WS2 | OK | Memory hours | Logic Apps / Standard / Standard Memory Duration | 1 GiB Hour | 0.011127 | 5110 | 56.86 |
| Logic Apps | WS3 | OK | vCPU hours | Logic Apps / Standard / Standard vCPU Duration | 1 Hour | 0.155483 | 2920 | 454.01 |
| Logic Apps | WS3 | OK | Memory hours | Logic Apps / Standard / Standard Memory Duration | 1 GiB Hour | 0.011127 | 10220 | 113.72 |
| Logic Apps | Consumption | WARN | Built-in actions | Logic Apps / Consumption / Consumption Built-in Actions | 1 | 0.000019 | 100000 | 1.82 |
| Logic Apps | Consumption | WARN | Standard connector actions | Logic Apps / Consumption / Consumption Standard Connector Actions | 1 | 0.000094 | 10000 | 0.94 |
| Service Bus | Basic | WARN | Operations | Service Bus / Basic / Basic Messaging Operations | 1M | 0.037593 | 1 | 0.04 |
| Service Bus | Standard | WARN | Base charge | Service Bus / Standard / Standard Base Unit | 1/Hour | 0.010106 | 730 | 7.38 |
| Service Bus | Standard | WARN | Operations | Service Bus / Standard / Standard Messaging Operations | 1M | 0.601481 | 1 | 0.00 |
| Service Bus | Premium | OK | Messaging units | Service Bus / Premium / Premium Messaging Unit | 1/Hour | 0.697342 | 730 | 509.06 |
| Key Vault | Standard | WARN | Operations | Key Vault / Standard / Operations | 10K | 0.022556 | 10 | 0.23 |
| Key Vault | Premium | WARN | Operations | Key Vault / Premium / Operations | 10K | 0.022556 | 10 | 0.23 |
| App Service plan | B1 | WARN | Plan instance hours | Azure App Service Basic Plan - Linux / B1 / B1 | 1 Hour | 0.013533 | 730 | 9.88 |
| App Service plan | S1 | WARN | Plan instance hours | Azure App Service Standard Plan - Linux / S1 / S1 App | 1 Hour | 0.075185 | 730 | 54.89 |
| App Service plan | P1v2 | WARN | Plan instance hours | Azure App Service Premium v2 Plan - Linux / P1 v2 / P1 v2 App | 1 Hour | 0.084959 | 730 | 62.02 |
| App Service plan | P0v3 | WARN | Plan instance hours | Azure App Service Premium v3 Plan - Linux / P0v3 / P0v3 App | 1 Hour | 0.065035 | 730 | 47.48 |
| App Service plan | P1v3 | WARN | Plan instance hours | Azure App Service Premium v3 Plan - Linux / P1 v3 / P1 v3 App | 1 Hour | 0.13007 | 730 | 94.95 |
| App Service plan | P3v3 | WARN | Plan instance hours | Azure App Service Premium v3 Plan - Linux / P3 v3 / P3 v3 App | 1 Hour | 0.520281 | 730 | 379.81 |
| App Service plan | P1mv3 | WARN | Plan instance hours | Azure App Service Premium v3 Plan - Linux / P1mv3 / P1mv3 App | 1 Hour | 0.156084 | 730 | 113.94 |
| Azure Front Door | Standard | WARN | Base fee | Azure Front Door / Standard / Standard Base Fees | 1/Month | 26.3148 | 1 | 26.31 |
| Azure Front Door | Standard | WARN | Requests | Azure Front Door / Standard / Standard Requests | 10K | 0.006767 | 100 | 0.68 |
| Azure Front Door | Standard | WARN | Data transfer out | Azure Front Door / Standard / Standard Data Transfer Out | 1 GB | 0.062028 | 10 | 0.62 |
| Azure Front Door | Premium | WARN | Base fee | Azure Front Door / Premium / Premium Base Fees | 1/Month | 248.110973 | 1 | 248.11 |
| Azure Front Door | Premium | WARN | Requests | Azure Front Door / Premium / Premium Requests | 10K | 0.011278 | 100 | 1.13 |
| Azure Front Door | Premium | WARN | Data transfer out | Azure Front Door / Premium / Premium Data Transfer Out | 1 GB | 0.062028 | 10 | 0.62 |
| Application Gateway | Standard v2 | WARN | Fixed cost | Application Gateway Standard v2 / Standard / Standard Fixed Cost | 1/Hour | 0.187963 | 730 | 137.21 |
| Application Gateway | Standard v2 | WARN | Capacity units | Application Gateway Standard v2 / Standard / Standard Capacity Units | 1/Hour | 0.006015 | 730 | 4.39 |
| Application Gateway | WAF v2 | WARN | Fixed cost | Application Gateway WAF v2 / Standard / Standard Fixed Cost | 1/Hour | 0.338333 | 730 | 246.98 |
| Application Gateway | WAF v2 | WARN | Capacity units | Application Gateway WAF v2 / Standard / Standard Capacity Units | 1/Hour | 0.010827 | 730 | 7.90 |
| Application Gateway | Basic v2 | WARN | Fixed cost | Application Gateway Basic v2 / Basic / Basic Fixed Cost | 1/Hour | 0.019894 | 730 | 14.52 |
| Application Gateway | Basic v2 | WARN | Capacity units | Application Gateway Basic v2 / Basic / Basic Capacity Units | 1/Hour | 0.006316 | 730 | 4.61 |
| Event Grid | Basic | WARN | Operations | Event Grid / Standard / Standard Operations | 100K | 0.045111 | 10 | 0.41 |
| Event Grid | Namespace | WARN | Throughput units | Event Grid / Standard / Standard Throughput Unit | 1 Hour | 0.030074 | 730 | 21.95 |
| Event Grid | Namespace | WARN | Event operations | Event Grid / Standard / Standard Event Operations | 1M | 0.451111 | 1 | 0.00 |
| Azure Cosmos DB (NoSQL) | Provisioned | WARN | Provisioned throughput | Azure Cosmos DB / RUs / 100 RU/s | 1/Hour | 0.006015 | 2920 | 17.56 |
| Azure Cosmos DB (NoSQL) | Provisioned | WARN | Data stored | Azure Cosmos DB / RUs / Data Stored | 1 GB/Month | 0.187963 | 10 | 1.88 |
| Azure Cosmos DB (NoSQL) | Serverless | WARN | Request units | Azure Cosmos DB serverless / RUs / 1M RUs | 1M | 0.2233 | 10 | 2.23 |
| Azure Cosmos DB (NoSQL) | Serverless | WARN | Data stored | Azure Cosmos DB / RUs / Data Stored | 1 GB/Month | 0.187963 | 10 | 1.88 |
