import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mise-meal-prep-ermizin.solar-hinny-0376.chatgpt.site"),
  title: "Mise — милпреп без суеты",
  description: "Персональный план питания, расчёт порций и единый список покупок на несколько дней.",
  icons: { icon: "/favicon.svg" },
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
  appleWebApp: { capable: true, title: "Mise", statusBarStyle: "black-translucent" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
