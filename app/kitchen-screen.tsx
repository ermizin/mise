"use client";
import { useEffect, useRef, useState } from "react";
import { applianceChoices, cookwareChoices, kitchenEquipment, type KitchenProfile } from "../domain/kitchen";
import type { KitchenSync } from "../hooks/use-kitchen";
import { withPlural, FORMS } from "../lib/plural";
import { Icon } from "./ui/icon";
import { Note } from "./ui/note";
import { Stepper } from "./ui/stepper";

export function KitchenIcon({ name }: { name: string }) {
  if (name === "scale" || name === "pot" || name === "container" || name === "flame") return <Icon name={name} size={24} />;
  if (name === "waffle") return <Icon name="meal-breakfast" size={24} />;
  // A CSS mask uses the generated alpha, preserving the shared semantic colors.
  return <span className="kitchen-generated-icon" aria-hidden="true" style={{ maskImage: `url(/kitchen-icons/${name}.png)`, WebkitMaskImage: `url(/kitchen-icons/${name}.png)` }} />;
}
export function KitchenScreen({ value, status, error, errorSection, editable, onChange, onRetry, onBack, hasPlan, planStale, onApply }: {
  value: KitchenProfile | null; status: KitchenSync; error: string; errorSection: string; editable: boolean;
  onChange: (value: KitchenProfile, section: string) => void; onRetry: () => void; onBack: () => void;
  hasPlan: boolean; planStale: boolean; onApply: () => void;
}) {
  const [containersOpen, setContainersOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [title, setTitle] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const savedWindowScroll = useRef(0);
  const close = useRef(onBack);
  const nested = useRef(false);
  useEffect(() => { close.current = onBack; nested.current = containersOpen; }, [onBack, containersOpen]);
  useEffect(() => {
    const pop = () => { if (nested.current) { setContainersOpen(false); requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = savedScroll.current; window.scrollTo({top:savedWindowScroll.current,behavior:"auto"}); }); } else close.current(); };
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, []);
  const warn = (block: string) => error && errorSection === block ? <Note tone="warn" role="alert">{error} {!editable && <button className="text-button" onClick={onRetry}>Повторить загрузку</button>}</Note> : null;
  return <section className="screen kitchen-screen has-stable-tab-header">
    <header className="kitchen-header">
      <button type="button" className="text-button" onClick={() => history.back()}><Icon name="chevron-left" size={18} />Назад</button>
      <h1>{containersOpen ? "Контейнеры" : "Кухня и техника"}</h1>
    </header>
    <div ref={scroll} className="tab-panel-body kitchen-body">
      <p className="kitchen-save-state" role="status">{status === "loading" ? "Загружаем кухню…" : status === "saving" ? "Сохраняем…" : status === "pending" ? "На устройстве · отправим при соединении" : status === "synced" ? "Изменения сохраняются автоматически" : "Не удалось сохранить изменение"}</p>
      {warn("summary")}
      {value && (containersOpen ? <section className="glass-card kitchen-section">
        <h2>Для готовых порций</h2><p>Укажите контейнеры, которые доступны сейчас. Их число не ограничивает меню автоматически.</p>
        <div className="kitchen-row"><span>Количество</span><Stepper label="Контейнеры" value={value.containers.count} max={200} disabled={!editable} onChange={count => onChange({ ...value, containers: { ...value.containers, count } }, "containers")} /></div>
        <div className="kitchen-row"><span>Отделений</span><Stepper label="Отделения" min={1} max={5} value={value.containers.compartments} disabled={!editable} onChange={compartments => onChange({ ...value, containers: { ...value.containers, compartments } }, "containers")} /></div>
        {warn("containers")}
      </section> : <>
        <section className="glass-card kitchen-section">
          <h2>Техника</h2><p>Отмечайте только то, чем правда готовите.</p>{warn("appliances")}
          <div className="kitchen-appliances" role="group" aria-label="Техника">
            {applianceChoices.map(({ id, label, icon }) => <button type="button" key={id} role="checkbox" aria-checked={value.appliances[id]} disabled={!editable}
              className={`kitchen-appliance${value.appliances[id] ? " selected" : ""}`}
              onClick={() => onChange({ ...value, appliances: { ...value.appliances, [id]: !value.appliances[id] } }, "appliances")}>
              <span className="kitchen-appliance-mark"><KitchenIcon name={icon} />{value.appliances[id] && <Icon name="check" size={16} />}</span>
              <b>{label}</b>{id === "scale" && <small>Порции по граммам</small>}
            </button>)}
          </div>
        </section>
        <section className="glass-card kitchen-section">
          <h2>Плита</h2>{warn("hob")}
          <div className="kitchen-row"><div><b>Горелок</b><p>Сколько можно занять одновременно</p></div><Stepper label="Горелки" max={6} value={value.hob.burners} disabled={!editable} onChange={burners => onChange({ ...value, hob: { ...value.hob, burners } }, "hob")} /></div>
          <div className="kitchen-hob-types" role="radiogroup" aria-label="Тип плиты">{([['gas','Газ'],['electric','Электрика'],['induction','Индукция']] as const).map(([type, label]) => <button key={type} type="button" role="radio" data-hob-type={type} tabIndex={value.hob.type === type ? 0 : -1} aria-checked={value.hob.type === type} disabled={!editable}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const types = ["gas", "electric", "induction"] as const;
              const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (types.indexOf(type) + (["ArrowLeft", "ArrowUp"].includes(event.key) ? 2 : 1)) % 3;
              const next = types[index];
              onChange({ ...value, hob: { ...value.hob, type: next } }, "hob");
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-hob-type="${next}"]`)?.focus();
            }} className={`chip ${value.hob.type === type ? "selected" : ""}`} onClick={() => onChange({ ...value, hob: { ...value.hob, type } }, "hob")}>{label}</button>)}</div>
          {value.hob.burners === 0 && <p>Плиты нет — подбираем другие способы.</p>}
        </section>
        <section className="glass-card kitchen-section kitchen-cookware">
          <h2>Посуда</h2>{warn("cookware")}
          {cookwareChoices.map(({ id, label, icon }) => <div className={`kitchen-row${value.cookware[id] === 0 ? " is-zero" : ""}`} key={id}><span className="kitchen-item-name"><KitchenIcon name={icon} />{label}</span><Stepper label={label} value={value.cookware[id]} disabled={!editable} onChange={count => onChange({ ...value, cookware: { ...value.cookware, [id]: count } }, "cookware")} /></div>)}
          <button className="kitchen-row kitchen-container-row" onClick={() => { savedScroll.current = scroll.current?.scrollTop ?? 0; savedWindowScroll.current = window.scrollY; history.pushState({ ...history.state, kitchenSection: "containers" }, ""); setContainersOpen(true); if (scroll.current) scroll.current.scrollTop = 0; window.scrollTo({top:0,behavior:"auto"}); }}><span className="kitchen-item-name"><KitchenIcon name="container" />Контейнеры</span><small>{value.containers.count} шт. · {value.containers.compartments} отд.</small><Icon name="chevron" size={16} /></button>
          {value.custom.map(item => <div className="kitchen-row kitchen-custom-row" key={item.id}><span>{item.title}</span><Stepper label={item.title} value={item.count} disabled={!editable} onChange={count => onChange({ ...value, custom: value.custom.map(other => other.id === item.id ? { ...other, count } : other) }, "custom")} /><button className="text-button" disabled={!editable} aria-label={`Удалить: ${item.title}`} onClick={() => onChange({ ...value, custom: value.custom.filter(other => other.id !== item.id) }, "custom")}><Icon name="close" size={16} /></button></div>)}
          {warn("custom")}
          {customOpen ? <form className="kitchen-custom-form" onSubmit={event => { event.preventDefault(); if (!title.trim() || value.custom.length >= 20) return; onChange({ ...value, custom: [...value.custom, { id: crypto.randomUUID(), title: title.trim(), count: 1 }] }, "custom"); setTitle(""); setCustomOpen(false); }}><label>Название<input value={title} maxLength={60} onChange={event => setTitle(event.target.value)} required /></label><button type="submit" className="secondary-button" disabled={!editable || !title.trim()}>Добавить</button><button type="button" className="text-button" onClick={() => setCustomOpen(false)}>Отмена</button></form> : <button className="kitchen-add" disabled={!editable || value.custom.length >= 20} onClick={() => setCustomOpen(true)}>Добавить свою позицию<Icon name="plus" size={20} /></button>}
          <p>Свои позиции — памятка для готовки, на подбор меню не влияют.</p>
        </section>
        <section className="glass-card kitchen-section">
          <h2>Что это даёт плану</h2>
          <p>Блюда подбираются по доступной технике и посуде. Комбайн и пароварка пока сохраняются как памятка.</p>
          <div className="kitchen-limit-chips"><span>{value.hob.burners} конф.</span><span>{withPlural(kitchenEquipment(value).length, ["вид", "вида", "видов"])} утвари для меню</span><span className="storage">{withPlural(value.containers.count, FORMS.container)}</span></div>
          <label aria-label="Параллельная готовка" htmlFor="profile-parallel" className="kitchen-parallel-toggle"><input id="profile-parallel" type="checkbox" checked={value.parallelCooking} disabled={!editable} onChange={event => onChange({ ...value, parallelCooking: event.target.checked }, "summary")} /><span><b>Параллельная готовка</b><small>Необязательно. Расчёт времени с учётом одного повара и вашей техники.</small></span></label>
          <p>В готовке партии можно указать интервалы, когда блюда не требуют внимания. Без них расписание последовательное. Тип плиты не меняет минуты без данных рецепта.</p>
          {status === "pending" && <p>Обновим настройки, когда появится сеть. <button className="text-button" onClick={onRetry}>Повторить отправку</button></p>}
          {!value.appliances.scale && <Note tone="warn">Для точной раскладки понадобятся весы. Расчётные граммы сохраняются; без фактического веса готового блюда точную массу контейнера определить нельзя.</Note>}
          {hasPlan && planStale && <div className="kitchen-plan-stale"><b>Текущее меню собрано по другой кухне</b><p>Проверим способы и подходящие блюда. До сохранения в мастере план останется прежним.</p><button type="button" className="secondary-button" disabled={!editable || status === "saving" || status === "pending"} onClick={onApply}>Проверить текущий план</button></div>}
          {!hasPlan && <p>Эту кухню подставим в следующий новый план.</p>}
        </section>
      </>)}
    </div>
  </section>;
}
