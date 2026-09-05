import { headers } from "next/headers";
import Link from "next/link";
import { isAnalyticsOwner } from "../../lib/analytics-owner";
import Dashboard from "./dashboard";
import "./dashboard.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Аналитика · Mise", robots: { index: false, follow: false } };
export default async function AnalyticsPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  if (!isAnalyticsOwner(userId)) return <main className="analytics-page"><section className="analytics-access glass-card">
    <p className="kicker">Аналитика Mise</p><h1>Нужен доступ владельца</h1>
    <p>Войдите с аккаунтом владельца, чтобы увидеть данные приложения.</p>
    {!userId && <a className="primary-button" href="/signin-with-chatgpt?return_to=%2Fanalytics">Войти как владелец</a>}
    <Link className="text-button" href="/">Вернуться в Mise</Link>
  </section></main>;
  return <Dashboard />;
}
