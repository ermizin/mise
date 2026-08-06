import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mise — Милпреп-план",
  description: "Планируйте меню и покупки на несколько дней.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
