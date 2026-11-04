import "./globals.css";
export const metadata = { title: "Azure Cost Estimator", description: "Estimate Azure costs from a spreadsheet using public retail prices" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
