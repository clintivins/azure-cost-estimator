import { workbook } from "@/lib/template";
export const dynamic = "force-static";
export function GET() {
  const buf = workbook([]);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=\"azure-estimate-template.xlsx\"",
      "cache-control": "public, max-age=3600",
    },
  });
}
