import { describe, it, expect } from "vitest";
import { selectVmMeters, selectAksMeters, aksTierPerHour, normaliseDiskSku, selectDiskMeter } from "@/lib/pricing";
import { vmOptions, finalise, normPricing } from "@/lib/estimate";

const it_ = (o: any) => ({ currencyCode: "GBP", unitPrice: o.retailPrice, armRegionName: "uksouth", armSkuName: "Standard_D4s_v5", serviceName: "Virtual Machines", unitOfMeasure: "1 Hour", skuName: "Standard_D4s_v5", productName: "Virtual Machines Dsv5 Series", type: "Consumption", ...o });
const items = [
  it_({ meterName: "D4s v5", retailPrice: 0.1669, savingsPlan: [{ term: "1 Year", retailPrice: 0.1254, unitPrice: 0.1254 }, { term: "3 Years", retailPrice: 0.0877, unitPrice: 0.0877 }] }),
  it_({ type: "Reservation", reservationTerm: "1 Year", meterName: "D4s v5", retailPrice: 902.22 }),
  it_({ type: "Reservation", reservationTerm: "3 Years", meterName: "D4s v5", retailPrice: 1732.27 }),
  it_({ meterName: "D4s v5 Spot", skuName: "Standard_D4s_v5 Spot", retailPrice: 0.0308 }),
  it_({ meterName: "D4s v5 Low Priority", skuName: "Standard_D4s_v5 Low Priority", retailPrice: 0.0334 }),
  it_({ productName: "Virtual Machines Dsv5 Series Windows", meterName: "D4s v5 Low Priority", retailPrice: 0.1218 }),
  it_({ productName: "Virtual Machines Dsv5 Series Windows", meterName: "D4s v5 Spot", retailPrice: 0.0564 }),
  it_({ productName: "Virtual Machines Dsv5 Series Windows", meterName: "D4s v5", retailPrice: 0.3053 }),
  it_({ productName: "Virtual Machines Dsv5 Series Windows", type: "DevTestConsumption", meterName: "D4s v5", retailPrice: 0.1669 }),
];

describe("meter selection", () => {
  const r = selectVmMeters(items as any, "Standard_D4s_v5", "uksouth", "GBP");
  it("picks linux/windows PAYG, spot, excludes low priority and devtest", () => {
    expect(r.linuxPayg).toBe(0.1669); expect(r.windowsPayg).toBe(0.3053);
    expect(r.linuxSpot).toBe(0.0308); expect(r.windowsSpot).toBe(0.0564);
  });
  it("picks reservations and savings plans", () => {
    expect(r.ri1y).toBe(902.22); expect(r.ri3y).toBe(1732.27); expect(r.sp1y).toBe(0.1254); expect(r.sp3y).toBe(0.0877);
  });
  it("AKS tiers", () => {
    const f = selectAksMeters([
      { type: "Consumption", productName: "Azure Kubernetes Service", meterName: "Standard Uptime SLA", retailPrice: 0.0752 },
      { type: "Consumption", productName: "Azure Kubernetes Service", meterName: "Standard Long Term Support", retailPrice: 0.4511 },
      { type: "Consumption", productName: "Azure Kubernetes Service", meterName: "FreeTierInfrastructureCost Uptime SLA", retailPrice: 0.03 },
    ] as any);
    expect(aksTierPerHour("Free", f)).toBe(0); expect(aksTierPerHour("Standard", f)).toBe(0.0752);
    expect(aksTierPerHour("Premium", f)).toBeCloseTo(0.5263);
  });
  it("disk", () => {
    expect(normaliseDiskSku("P10")).toBe("P10 LRS"); expect(normaliseDiskSku("p10 zrs")).toBe("p10 ZRS");
    const d = selectDiskMeter([
      { type: "Consumption", productName: "Premium Page Blob", meterName: "P10 LRS Disk", unitOfMeasure: "1/Month", retailPrice: 1 },
      { type: "Consumption", productName: "Premium SSD Managed Disks", meterName: "P10 LRS Disk Mount", unitOfMeasure: "1/Month", retailPrice: 2 },
      { type: "Consumption", productName: "Premium SSD Managed Disks", meterName: "P10 LRS Disk", unitOfMeasure: "1/Month", retailPrice: 17.93 },
    ] as any);
    expect(d?.retailPrice).toBe(17.93);
  });
});

describe("calc", () => {
  const r = selectVmMeters(items as any, "Standard_D4s_v5", "uksouth", "GBP");
  it("linux options", () => {
    const o = vmOptions(r, 2, 730, false);
    expect(o.payg).toBeCloseTo(0.1669 * 730 * 2); expect(o.ri3y).toBeCloseTo((1732.27 / 36) * 2); expect(o.ri1y).toBeCloseTo((902.22 / 12) * 2);
  });
  it("windows adds licence to RI/SP", () => {
    const o = vmOptions(r, 1, 730, true);
    expect(o.payg).toBeCloseTo(0.3053 * 730); expect(o.ri1y).toBeCloseTo(902.22 / 12 + (0.3053 - 0.1669) * 730);
  });
  it("fallback to PAYG with WARN and discount", () => {
    const base = { name: "x", service: "VM", arm_sku: "s", region: "r", quantity: 1, hours_per_month: 730, os: "Linux", pricing: "RI1Y", status: "OK" as const, message: "" };
    const res = finalise(base, { payg: 100 }, "RI1Y", 10);
    expect(res.status).toBe("WARN"); expect(res.chosen_option).toBe("PAYG"); expect(res.chosen_month).toBe(90); expect(res.chosen_year).toBe(1080);
  });
  it("pricing normalisation", () => { expect(normPricing("ri 3y")).toBe("RI3Y"); expect(normPricing("spot")).toBe("Spot"); expect(normPricing("bad")).toBeUndefined(); });
});
