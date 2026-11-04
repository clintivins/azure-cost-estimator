import { workbook, SAMPLE_ROWS } from "@/lib/template";
export const dynamic = "force-static";
export function GET() {
  const buf = workbook(SAMPLE_ROWS);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=\"azure-estimate-sample.xlsx\"",
      "cache-control": "public, max-age=3600",
    },
  });
}
