import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mappatura Scaffali",
  description: "Mappa categorie prodotto sugli scaffali del negozio",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mappatura Scaffali",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f3f4f6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className="min-h-screen-safe bg-gray-50 antialiased">{children}</body>
    </html>
  );
}
