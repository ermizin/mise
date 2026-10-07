/* Яндекс Метрика нужна рекламе. По ней Директ видит, кто из пришедших по
   объявлению начал и сохранил план, и учится приводить таких людей, а не
   случайные нажатия в мобильных играх. Поэтому счётчик получает только адрес
   входа с метками рекламы и названия целей: без вебвизора, карты кликов,
   полей форм и данных плана. */
export const yandexMetrikaCounterId = 113511651;

/* Цель Метрики по умолчанию срабатывает, если её идентификатор содержится в
   названии события, поэтому ни один идентификатор не входит в другой:
   иначе «plan_created» засчитывался бы и для «next_plan_created». */
const metrikaGoals: Record<string, string> = {
  onboarding_completed: "mise_onboarding_done",
  plan_create_started: "mise_plan_started",
  plan_created: "mise_plan_saved",
  next_plan_created: "mise_next_plan",
  calendar_exported: "mise_calendar",
  cooking_confirmed: "mise_cooked",
  app_installed: "mise_installed",
};

/* Из адреса остаются только utm-метки и yclid: по yclid Метрика связывает
   визит с кликом в Директе. Фрагмент со ссылкой из календаря несёт ключ
   устройства и в Метрику не уходит. */
export function metrikaLandingUrl(href: string): string {
  const url = new URL(href);
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams)
    if (key.startsWith("utm_") || key === "yclid") kept.append(key, value);
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

export function metrikaGoal(eventName: string): string | null {
  return Object.hasOwn(metrikaGoals, eventName) ? metrikaGoals[eventName] : null;
}

type YandexMetrika = ((...args: unknown[]) => void) & {
  a?: unknown[][];
  l?: number;
};

let metrikaStarted = false;

/* Вызывается до того, как приложение уберёт метки из адреса. */
export function startYandexMetrika() {
  if (metrikaStarted || !yandexMetrikaCounterId || typeof window === "undefined")
    return;
  metrikaStarted = true;
  const host = window as unknown as { ym?: YandexMetrika };
  const ym: YandexMetrika =
    host.ym ??
    Object.assign(
      (...args: unknown[]) => {
        (ym.a ??= []).push(args);
      },
      { l: Date.now() },
    );
  host.ym = ym;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://mc.yandex.ru/metrika/tag.js";
  document.head.appendChild(script);
  ym(yandexMetrikaCounterId, "init", {
    defer: true,
    webvisor: false,
    clickmap: false,
    trackLinks: false,
    trackHash: false,
    accurateTrackBounce: true,
  });
  ym(yandexMetrikaCounterId, "hit", metrikaLandingUrl(location.href), {
    referer: document.referrer,
    title: document.title,
  });
}

export function reachYandexMetrikaGoal(eventName: string) {
  const goal = metrikaGoal(eventName);
  if (!goal) return;
  startYandexMetrika();
  const ym = (window as unknown as { ym?: YandexMetrika }).ym;
  if (metrikaStarted && ym) ym(yandexMetrikaCounterId, "reachGoal", goal);
}
