import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mise.ermizinm.ru"),
  applicationName: "Mise",
  title: "Mise — милпреп без суеты",
  description: "Персональный план питания, расчёт порций и единый список покупок на несколько дней.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Mise — милпреп без суеты",
    description: "План питания, индивидуальные порции и покупки в одном понятном сценарии.",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "Mise — милпреп без суеты" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mise — милпреп без суеты",
    description: "План питания, индивидуальные порции и покупки в одном понятном сценарии.",
    images: ["/og.png"],
  },
  appleWebApp: { capable: true, title: "Mise", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#e5ece7",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
