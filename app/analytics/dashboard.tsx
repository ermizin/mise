"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardReport } from "../../lib/analytics-dashboard-report";

const integer = (value: number) => value.toLocaleString("ru-RU");
const pct = (value: number | null) => value === null ? "—" : `${value.toLocaleString("ru-RU")}%`;
const minutes = (value: number | null) => value === null ? "—" : `${(value / 60000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} мин`;
const date = (value: number) => new Date(value).toLocaleDateString("ru-RU", { timeZone: "UTC" });
const time = (value: number) => new Date(value).toLocaleString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const delta = (current: number, previous: number) => previous === 0 ? current === 0 ? "Без изменений" : "Нет базы для сравнения" : `${current - previous > 0 ? "+" : ""}${integer(current - previous)} · ${current >= previous ? "+" : ""}${Math.round((current / previous - 1) * 100)}% к прошлому периоду`;
const initialQuery = "days=30&identity=all&excludeOwner=1";
const tabs = [{ id: "overview", label: "Обзор" }, { id: "journey", label: "Путь к готовке" }, { id: "content", label: "Рецепты и действия" }, { id: "errors", label: "Ошибки и события" }] as const;
type Tab = typeof tabs[number]["id"];

export default function Dashboard() {
  const [query, setQuery] = useState<string | null>(null);
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => {
    const read = () => { const params = new URLSearchParams(window.location.search); params.delete("format"); setLoading(true); setError(""); setQuery(params.toString() || initialQuery); };
    read(); window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  useEffect(() => {
    if (query === null) return;
    const abort = new AbortController();
    fetch(`/api/analytics/dashboard?${query}`, { signal: abort.signal, cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(response.status === 403 ? "Сессия владельца завершилась. Войдите снова." : data.error || "Не удалось загрузить отчёт."); return data; })
      .then((data: DashboardReport) => { if (!abort.signal.aborted) setReport(data); })
      .catch((failure: Error) => { if (!abort.signal.aborted) setError(failure.message || "Нет соединения с сервером."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [query, refresh]);
  const params = new URLSearchParams(query ?? initialQuery);
  function change(values: Record<string, string | null>) {
    const next = new URLSearchParams(query ?? initialQuery); next.delete("format");
    for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); }
    const value = next.toString(); window.history.pushState(null, "", `/analytics?${value}`); setLoading(true); setError(""); setQuery(value);
  }
  function reload() { setLoading(true); setError(""); setRefresh((value) => value + 1); }
  const ready = report && !loading && !error;
  return <main className="mise-dashboard">
    <header className="md-header"><div><Link href="/" className="md-brand">mise<span> / аналитика</span></Link><h1>Как используют Mise</h1></div>
      <div className="md-header-actions"><Link href="/pilot-analytics">Пилот · 5 участников</Link><button type="button" onClick={reload} disabled={loading}>Обновить</button>{ready && <a className="md-export" href={`/api/analytics/dashboard?${query}&format=csv`}>Скачать CSV</a>}</div>
    </header>
    <section className="md-filters" aria-label="Фильтры отчёта">
      <div className="md-presets" aria-label="Период">{[7, 30, 90].map((days) => <button key={days} type="button" aria-pressed={!params.has("from") && (params.get("days") ?? "30") === String(days)} onClick={() => change({ days: String(days), from: null, to: null })}>{days} дней</button>)}</div>
      <label>Участники<select value={params.get("identity") ?? "all"} onChange={(e) => change({ identity: e.target.value })}><option value="all">Все идентификаторы</option><option value="device">Устройства</option><option value="sites">Аккаунты Sites</option></select></label>
      <label className="md-check"><input type="checkbox" checked={params.get("excludeOwner") !== "0"} onChange={(e) => change({ excludeOwner: e.target.checked ? "1" : "0" })}/>Без аккаунта владельца</label>
      <details className="md-dates"><summary>Свои даты</summary><form key={query} onSubmit={(e) => { e.preventDefault(); const fields = new FormData(e.currentTarget); change({ from: String(fields.get("from")), to: String(fields.get("to")) }); }}>
        <label>С<input name="from" type="date" required defaultValue={params.get("from") ?? ""}/></label><label>По<input name="to" type="date" required defaultValue={params.get("to") ?? ""}/></label><button type="submit">Применить</button><small>До 90 дней. Даты и время — UTC.</small>
      </form></details>
    </section>
    <nav className="md-tabs" aria-label="Разделы аналитики">{tabs.map((item) => <button key={item.id} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {loading && <section className="md-status" role="status">Загружаем события и рассчитываем показатели…</section>}
    {error && <section className="md-status md-failure" role="alert"><h2>Отчёт недоступен</h2><p>{error}</p><button onClick={reload}>Повторить</button><a href="/signin-with-chatgpt?return_to=%2Fanalytics">Войти заново</a></section>}
    {ready && <>
      <p className="md-period">{date(report.options.start)} — {date(report.options.end - 1)} · UTC <span>Сравнение: {time(report.previousStart)} — {time(report.options.start)} · равная длительность</span></p>
      {report.metrics.active === 0 && <section className="md-empty"><h2>За этот период событий нет</h2><p>Выберите другие даты или включите аккаунт владельца. Новые действия появятся здесь после их записи приложением.</p></section>}
      {tab === "overview" && <Overview report={report}/>}
      {tab === "journey" && <Journey report={report}/>}
      {tab === "content" && <Content report={report}/>}
      {tab === "errors" && <Errors report={report}/>}
      <details className="md-method"><summary>Как читать эти данные</summary><p>Участник — отдельный псевдонимизированный идентификатор устройства или аккаунта. Это не точное число людей: новый браузер, очистка данных или вход в аккаунт могут создать другой идентификатор. Фильтр владельца исключает только его авторизованный аккаунт.</p><p>Активность — любое записанное событие. Открытия приложения не называются сессиями. «Новый» означает первое известное событие за всю сохранённую историю. Время отчёта — серверное время записи, UTC; отложенная доставка может сместить день действия.</p><p>Обновлённый сбор открытий, шагов мастера и ID карточек не восстанавливает прошлые действия. Доставка аналитики может не состояться при потере сети или блокировке браузером, поэтому ноль событий сам по себе не доказывает отсутствие действий.</p><p>Данные параметров тела, КБЖУ, исключений, состава планов и покупок не собираются. В рейтинге карточек используется только публичный ID открытого рецепта. На больших объёмах отчёт попросит сократить период, вместо того чтобы выдавать усечённую выборку за полную.</p></details>
      <footer className="md-footer"><span>Рассчитано {time(report.generatedAt)} UTC</span><span>{report.lastEventAt ? `Последнее событие ${time(report.lastEventAt)} UTC` : "Нет событий по выбранным фильтрам"}</span></footer>
    </>}
  </main>;
}
function Metric({ label, value, note, comparison }: { label: string; value: string; note: string; comparison?: string }) {
  return <article className="md-metric"><h2>{label}</h2><strong>{value}</strong><p>{note}</p>{comparison && <small>{comparison}</small>}</article>;
}
function Overview({ report: r }: { report: DashboardReport }) {
  return <>
    <section className="md-kpis" aria-label="Главные показатели">
      <Metric label="Активные участники" value={integer(r.metrics.active)} note={`${integer(r.metrics.newActors)} впервые появились за период`} comparison={delta(r.metrics.active, r.previous.active)}/>
      <Metric label="Сохранённые планы" value={integer(r.metrics.plans)} note={`${integer(r.metrics.creators)} участников создали план`} comparison={delta(r.metrics.plans, r.previous.plans)}/>
      <Metric label="Подтвердили готовку" value={integer(r.metrics.cooks)} note="Нажали «Партия приготовлена»" comparison={delta(r.metrics.cooks, r.previous.cooks)}/>
      <Metric label="Создали следующий план" value={integer(r.metrics.repeatPlanners)} note="Отдельно от открытия старого плана" comparison={delta(r.metrics.repeatPlanners, r.previous.repeatPlanners)}/>
    </section>
    <div className="md-grid"><Activity report={r}/><section className="md-panel md-pulse"><h2>Качество опыта</h2><dl><div><dt>Медиана создания плана</dt><dd>{minutes(r.metrics.medianPlanMs)}</dd></div><div><dt>90% планов созданы за</dt><dd>{minutes(r.metrics.p90PlanMs)}</dd></div><div><dt>Участники с ошибками</dt><dd>{r.metrics.errorActors} / {r.metrics.active}<small>{pct(r.metrics.errorRate)}</small></dd></div><div><dt>Открытия приложения</dt><dd>{integer(r.metrics.opens)}</dd></div></dl><p className="md-muted">Время включает паузы и восстановление черновика. Открытия доступны только после расширения сбора событий.</p></section></div>
    <section className="md-panel"><div className="md-section-head"><h2>Возвращаются ли участники</h2><span>По первым известным событиям</span></div><div className="md-retention-cards">{r.retention.map((point) => <article key={point.day}><h3>На {point.day}-й день</h3><strong>{pct(point.rate)}</strong><p>{point.eligible ? `${point.returned} из ${point.eligible} участников` : "Ещё нет зрелой выборки"}</p></article>)}</div><p className="md-muted">Любое событие точно на D1, D7 или D30 после первого известного дня. День возврата должен закончиться целиком. Возвраты после выбранного периода учитываются до текущей даты.</p>
      {r.cohorts.length > 0 && <div className="md-table-scroll"><table><caption>Новые участники по неделям первого события</caption><thead><tr><th>Неделя с</th><th>Новые</th><th>D1</th><th>D7</th><th>D30</th></tr></thead><tbody>{r.cohorts.map((cohort) => <tr key={cohort.week}><th>{cohort.week}</th><td>{cohort.size}</td>{cohort.retention.map((p) => <td key={p.day} className={p.rate === null ? "md-pending" : p.rate >= 50 ? "md-retained" : ""}>{pct(p.rate)}<small>{p.eligible ? `${p.returned} / ${p.eligible}` : "Ожидаем"}</small></td>)}</tr>)}</tbody></table></div>}
    </section>
  </>;
}
function Activity({ report }: { report: DashboardReport }) {
  const [metric, setMetric] = useState<"active" | "plans" | "errors">("active");
  const labels = { active: "Участники", plans: "Планы", errors: "Ошибки" };
  const values = report.daily.map((r) => r[metric]);
  const max = Math.max(1, ...values); const width = 700; const height = 190;
  const x = (i: number) => 28 + i * (width - 56) / Math.max(1, values.length - 1);
  const y = (v: number) => height - 18 - v / max * (height - 38);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return <section className="md-panel md-activity"><div className="md-section-head"><h2>Динамика по дням</h2><div className="md-chart-toggle">{Object.entries(labels).map(([key, label]) => <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key as typeof metric)}>{label}</button>)}</div></div>
    <svg className="md-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${labels[metric]} по дням. Точные значения доступны в таблице ниже.`}>
      {[0, .5, 1].map((v) => <g key={v}><line x1="28" x2={width - 28} y1={y(max * v)} y2={y(max * v)} className="md-gridline"/><text x="3" y={y(max * v) - 5}>{(max * v).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}</text></g>)}
      <polygon points={`${x(0)},${y(0)} ${points} ${x(values.length - 1)},${y(0)}`} className="md-chart-area"/><polyline points={points} className="md-chart-line"/>
      {values.map((v, i) => <circle key={report.daily[i].date} cx={x(i)} cy={y(v)} r={values.length > 45 ? 2 : 3.5}><title>{report.daily[i].date}: {v}</title></circle>)}
    </svg><div className="md-chart-axis"><span>{report.daily[0]?.date}</span><span>{report.daily.at(-1)?.date}</span></div>
    <details className="md-chart-table"><summary>Точные значения по дням</summary><div className="md-table-scroll"><table><thead><tr><th>Дата UTC</th><th>Участники</th><th>Планы</th><th>Готовили</th><th>Ошибки</th></tr></thead><tbody>{report.daily.map((d) => <tr key={d.date}><th>{d.date}</th><td>{d.active}</td><td>{d.plans}</td><td>{d.cooks}</td><td>{d.errors}</td></tr>)}</tbody></table></div></details>
  </section>;
}
function Journey({ report: r }: { report: DashboardReport }) {
  return <><div className="md-grid"><section className="md-panel"><h2>От плана до следующей готовки</h2><p className="md-muted">Участник проходит этапы последовательно внутри выбранного периода. Планы, начатые раньше периода, сюда не входят.</p><div className="md-funnel">{r.funnel.map((row, index) => <article key={row.eventName}><div><span><i>{index + 1}</i>{row.label}</span><strong>{row.count}</strong></div><progress value={row.count} max={Math.max(1, r.funnel[0].count)} aria-label={row.label}/><small>{index ? `${pct(row.conversion)} от предыдущего этапа · ${row.lost} не дошли` : "База последовательной воронки"}</small></article>)}</div></section>
    <section className="md-panel"><h2>Где останавливаются в мастере</h2><p className="md-muted">{r.wizardFlows} попыток с новыми событиями шагов · {r.wizardSaved} сохранены за период.</p>{r.wizardFlows ? <div className="md-table-scroll"><table><thead><tr><th>Шаг</th><th>Увидели</th><th>Не завершили*</th></tr></thead><tbody>{r.wizard.map((row, i) => <tr key={row.label}><th>{i + 1}. {row.label}</th><td>{row.count}</td><td>{row.stalled || "—"}</td></tr>)}</tbody></table></div> : <p className="md-empty-small">Номера шагов начнут появляться после обновления приложения.</p>}<p className="md-muted">* Последний достигнутый шаг в попытках старше 24 часов без сохранения к текущему моменту. Это сигнал для проверки, а не доказательство ухода. Возвраты назад не увеличивают число попыток.</p></section></div>
    <section className="md-panel"><h2>Засчитываем реальные действия</h2><p>Покупка — успешно сохранённая отметка товара. Готовка — подтверждение приготовленной партии. Открытия списка или инструкции показываем в разделе «Рецепты и действия».</p><p className="md-muted">Этапы связаны с участником, но не с конкретным планом: ID сохранённого плана в событиях нет. Критерии первого пилота остаются в <Link href="/pilot-analytics">отдельной сводке</Link>.</p></section></>;
}
function Content({ report: r }: { report: DashboardReport }) {
  return <div className="md-grid"><section className="md-panel"><h2>Какие карточки открывают</h2><p className="md-muted">Топ-20 по числу участников. Просмотр карточки не означает выбор в меню или приготовление.</p>{r.recipes.length ? <div className="md-table-scroll"><table><thead><tr><th>Рецепт</th><th>Участники</th><th>Открытия</th></tr></thead><tbody>{r.recipes.map((recipe, i) => <tr key={recipe.id}><th><span className="md-rank">{i + 1}</span><a href={`/?recipe=${encodeURIComponent(recipe.id)}`}>{recipe.title}</a></th><td>{recipe.actors}</td><td>{recipe.opens}</td></tr>)}</tbody></table></div> : <p className="md-empty-small">Открытий с ID карточки пока нет. Старые события нельзя распределить по рецептам.</p>}<p className="md-muted">Без ID карточки: {r.recipeOpensWithoutId} открытий.</p></section>
    <section className="md-panel"><h2>Действия в приложении</h2><div className="md-table-scroll"><table><thead><tr><th>Действие</th><th>Участники</th><th>События</th></tr></thead><tbody>{r.events.map((event) => <tr key={event.eventName}><th>{event.label}</th><td>{event.actors}</td><td>{event.count}</td></tr>)}</tbody></table></div></section></div>;
}
function Errors({ report: r }: { report: DashboardReport }) {
  return <><section className="md-kpis md-kpis-three"><Metric label="Блокирующие ошибки" value={integer(r.metrics.errors)} note="События с известным кодом" comparison={delta(r.metrics.errors, r.previous.errors)}/><Metric label="Затронутые участники" value={integer(r.metrics.errorActors)} note={`Из ${r.metrics.active} активных за период`}/><Metric label="Доля с ошибками" value={pct(r.metrics.errorRate)} note="Участники с ошибкой / все активные"/></section>
    <section className="md-panel"><h2>На каком действии возникают ошибки</h2><div className="md-table-scroll"><table><thead><tr><th>Действие</th><th>Ошибки</th><th>Участники</th><th>Последняя, UTC</th></tr></thead><tbody>{r.errors.map((error) => <tr key={error.code}><th>{error.label}</th><td>{error.count}</td><td>{error.actors}</td><td>{error.lastAt ? time(error.lastAt) : "—"}</td></tr>)}</tbody></table></div><p className="md-muted">Это ошибки, которые успел отправить клиент. Сбой соединения может помешать доставке самого события.</p></section>
    <section className="md-panel"><h2>Последние 40 событий</h2><div className="md-table-scroll"><table><thead><tr><th>Время, UTC</th><th>Участник</th><th>Событие</th><th>Деталь</th></tr></thead><tbody>{r.recent.map((event) => <tr key={event.eventId}><td>{time(event.at)}</td><th>{event.participant}<small>{event.kind === "sites" ? "Аккаунт" : "Устройство"}</small></th><td>{event.label}</td><td>{event.detail ?? "—"}</td></tr>)}</tbody></table></div>{!r.recent.length && <p className="md-muted">Событий пока нет.</p>}</section></>;
}
