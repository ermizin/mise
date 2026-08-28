import { headers } from "next/headers";
import Link from "next/link";
import { isAnalyticsOwner } from "../../lib/analytics-owner";
import { loadPilotSummary } from "../../lib/pilot-report";

export const dynamic = "force-dynamic";

const yes = (value: boolean) => (value ? "Да" : "—");
const status = (value: boolean) => (value ? "Достигнут" : "Пока нет");

export default async function PilotAnalyticsPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  if (!isAnalyticsOwner(userId)) {
    return (
      <main className="analytics-page">
        <section className="analytics-access glass-card">
          <p className="kicker">Закрытая сводка</p>
          <h1>Нужен доступ владельца</h1>
          <p>
            Данные пилота доступны только владельцу Mise через вход Sites.
            Отдельного аккаунта Mise не требуется.
          </p>
          {!userId && (
            <a
              className="primary-button"
              href="/signin-with-chatgpt?return_to=%2Fpilot-analytics"
            >
              Войти как владелец
            </a>
          )}
          <Link className="text-button" href="/">
            Вернуться в Mise
          </Link>
        </section>
      </main>
    );
  }

  const summary = await loadPilotSummary();
  return (
    <main className="analytics-page">
      <header className="analytics-header">
        <div>
          <p className="kicker">Закрытый пилот · 5 человек</p>
          <h1>Сводка Mise</h1>
          <p>Фактические действия отдельно от простых открытий экранов.</p>
        </div>
        <a
          className="secondary-button"
          href="/api/analytics/summary?format=csv"
        >
          Выгрузить CSV
        </a>
      </header>
      <section className="analytics-thresholds">
        <article className="glass-card">
          <p>План до 10 минут</p>
          <h2>{summary.planUnderTenMinutes}/5</h2>
          <b>{status(summary.thresholds.plan)} · цель 4/5</b>
        </article>
        <article className="glass-card">
          <p>Покупка и готовка</p>
          <h2>{summary.purchaseAndCooking}/5</h2>
          <b>{status(summary.thresholds.action)} · цель 3/5</b>
        </article>
        <article className="glass-card">
          <p>Следующий план</p>
          <h2>{summary.returnedAndCreatedNextPlan}/5</h2>
          <b>{status(summary.thresholds.return)} · цель 3/5</b>
        </article>
      </section>
      <section className="analytics-note glass-card">
        <b>Засчитываем реальные действия</b>
        <p>
          Покупка — только отметка товара. Готовка — только нажатие «Партия
          приготовлена». Открытие покупок или инструкции само по себе не
          считается покупкой или готовкой.
        </p>
      </section>
      <section className="analytics-table-wrap glass-card">
        <table>
          <thead>
            <tr>
              <th>Участник</th>
              <th>Онбординг</th>
              <th>План ≤10 мин</th>
              <th>Ошибки</th>
              <th>Покупки открыты</th>
              <th>Товар отмечен</th>
              <th>Инструкции открыты</th>
              <th>Готовка подтверждена</th>
              <th>План открыт снова</th>
              <th>Следующий план</th>
            </tr>
          </thead>
          <tbody>
            {summary.participants.map((item) => (
              <tr key={item.label}>
                <th>
                  {item.label}
                  <small>
                    {item.firstSeenAt
                      ? new Date(item.firstSeenAt).toLocaleDateString("ru-RU")
                      : "ещё не появился"}
                  </small>
                </th>
                <td>{yes(item.onboardingCompleted)}</td>
                <td>
                  {item.firstEligiblePlanDurationMs === null
                    ? "—"
                    : `${Math.round(item.firstEligiblePlanDurationMs / 600) / 100} мин`}
                </td>
                <td>{item.blockingErrors || "—"}</td>
                <td>{yes(item.shoppingOpened)}</td>
                <td>{yes(item.shoppingConfirmed)}</td>
                <td>{yes(item.cookingInstructionsOpened)}</td>
                <td>{yes(item.cookingConfirmed)}</td>
                <td>{yes(item.savedPlanReopened)}</td>
                <td>{yes(item.nextPlanCreated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {summary.extraParticipantsExcluded > 0 && (
        <p className="analytics-footnote">
          В сводку входят первые 5 участников пилота; ещё{" "}
          {summary.extraParticipantsExcluded} идентификаторов не включены.
        </p>
      )}
      <p className="analytics-footnote">
        Обновлено {new Date(summary.generatedAt).toLocaleString("ru-RU")}.
        Идентификаторы псевдонимизированы; чувствительные данные плана в события
        не попадают.
      </p>
    </main>
  );
}
