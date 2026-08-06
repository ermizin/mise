"use client";

import { useMemo, useState } from "react";

type Meal = {
  id: number;
  title: string;
  emoji: string;
  meal: string;
  time: string;
  kcal: number;
  protein: number;
  ingredients: { name: string; amount: string; group: string }[];
  steps: string[];
};

const meals: Meal[] = [
  {
    id: 1, title: "Пананг карри с курицей", emoji: "🍛", meal: "Обед", time: "25 мин", kcal: 540, protein: 54,
    ingredients: [
      { name: "Куриное филе", amount: "1,2 кг", group: "Мясо и рыба" }, { name: "Коричневый рис", amount: "200 г", group: "Крупы" },
      { name: "Болгарский перец", amount: "3 шт.", group: "Овощи и фрукты" }, { name: "Стручковая фасоль", amount: "340 г", group: "Овощи и фрукты" },
      { name: "Кокосовое молоко", amount: "450 мл", group: "Бакалея" }, { name: "Паста карри", amount: "2 ст. л.", group: "Бакалея" },
      { name: "Арахисовая паста", amount: "1½ ст. л.", group: "Бакалея" }, { name: "Лайм", amount: "1 шт.", group: "Овощи и фрукты" },
    ],
    steps: ["Свари рис по инструкции на упаковке.", "Нарежь курицу, перец и фасоль. Разогрей сковороду.", "Обжарь курицу 6–8 минут до готовности.", "Добавь пасту карри и прогрей 1 минуту.", "Влей кокосовое молоко, добавь овощи и арахисовую пасту. Туши 5–7 минут.", "Сбрызни лаймом, раздели по контейнерам и дай остыть."]
  },
  {
    id: 2, title: "Куриный боул по-корейски", emoji: "🥗", meal: "Ужин", time: "20 мин", kcal: 510, protein: 48,
    ingredients: [{ name: "Куриное филе", amount: "800 г", group: "Мясо и рыба" }, { name: "Рис", amount: "250 г", group: "Крупы" }, { name: "Огурцы", amount: "2 шт.", group: "Овощи и фрукты" }, { name: "Морковь", amount: "3 шт.", group: "Овощи и фрукты" }, { name: "Соевый соус", amount: "80 мл", group: "Бакалея" }],
    steps: ["Свари рис.", "Замаринуй и обжарь курицу.", "Нарежь овощи тонкой соломкой.", "Разложи рис, курицу и овощи по контейнерам."]
  },
  {
    id: 3, title: "Индейка с овощами", emoji: "🥘", meal: "Обед", time: "30 мин", kcal: 490, protein: 46,
    ingredients: [{ name: "Филе индейки", amount: "900 г", group: "Мясо и рыба" }, { name: "Красный картофель", amount: "1 кг", group: "Овощи и фрукты" }, { name: "Авокадо", amount: "2 шт.", group: "Овощи и фрукты" }, { name: "Томаты", amount: "4 шт.", group: "Овощи и фрукты" }],
    steps: ["Запеки картофель до мягкости.", "Обжарь индейку со специями.", "Собери порции с овощами и соусом."]
  }
];

const dayNames = ["Пн, 10 авг", "Вт, 11 авг", "Ср, 12 авг", "Чт, 13 авг"];

export default function Home() {
  const [tab, setTab] = useState<"plan" | "recipes" | "shopping">("plan");
  const [selected, setSelected] = useState<Meal | null>(null);
  const [days, setDays] = useState(3);
  const [checked, setChecked] = useState<string[]>([]);
  const plan = useMemo(() => [meals[0], meals[1], meals[2], meals[0]], []);
  const shopping = useMemo(() => {
    const items = plan.slice(0, days).flatMap((m) => m.ingredients);
    return items.reduce<Record<string, typeof items>>((acc, item) => { (acc[item.group] ??= []).push(item); return acc; }, {});
  }, [plan, days]);

  if (selected) return <RecipeView meal={selected} onBack={() => setSelected(null)} days={days} />;

  return <main className="phone-shell">
    <header className="topbar">
      <div><span className="eyebrow">Mise</span><h1>{tab === "plan" ? "Мой план" : tab === "recipes" ? "Рецепты" : "Покупки"}</h1></div>
      <button className="avatar" aria-label="Профиль">М</button>
    </header>

    {tab === "plan" && <section className="screen">
      <div className="hero"><div><p className="muted">План на</p><strong>{days} дня</strong></div><div className="day-picker">{[2,3,4,5].map(d => <button key={d} onClick={() => setDays(d)} className={days === d ? "active" : ""}>{d}</button>)}</div></div>
      <div className="nutrition"><div className="cal"><b>{days * 1050}</b><span>ккал</span></div><div><p><span>Белки</span><b>{days * 102} г</b></p><i><em style={{width: "82%"}} /></i><p><span>Жиры</span><b>{days * 38} г</b></p><i><em className="fat" style={{width: "56%"}} /></i><p><span>Углеводы</span><b>{days * 146} г</b></p><i><em className="carbs" style={{width: "68%"}} /></i></div></div>
      {plan.slice(0, days).map((meal, index) => <article className="meal-card" key={`${meal.id}-${index}`} onClick={() => setSelected(meal)}>
        <div className="meal-icon">{meal.emoji}</div><div className="meal-copy"><span>{dayNames[index]} · {meal.meal}</span><h2>{meal.title}</h2><p>{meal.time} · {meal.kcal} ккал · <b>{meal.protein} г белка</b></p></div><span className="arrow">›</span>
      </article>)}
      <button className="wide-btn" onClick={() => setTab("recipes")}>＋ Добавить блюдо</button>
    </section>}

    {tab === "recipes" && <section className="screen recipes"><div className="filter-row"><button className="filter active">Высокий белок</button><button className="filter">До 30 минут</button></div><h2>Подходящие рецепты</h2><div className="recipe-grid">{meals.map(m => <button className="recipe-tile" key={m.id} onClick={() => setSelected(m)}><span>{m.emoji}</span><strong>{m.title}</strong><small>{m.time} · {m.kcal} ккал</small><b>＋</b></button>)}</div></section>}

    {tab === "shopping" && <section className="screen"><div className="shopping-head"><div><p className="muted">На {days} дня</p><h2>Общий список</h2></div><span className="count">{Object.values(shopping).flat().length}</span></div>{Object.entries(shopping).map(([group, items]) => <section className="shopping-group" key={group}><h3>{group}</h3>{items.map((item, i) => { const key = group + item.name + i; const done = checked.includes(key); return <button className={done ? "grocery done" : "grocery"} key={key} onClick={() => setChecked(done ? checked.filter(x => x !== key) : [...checked, key])}><span className="check">{done ? "✓" : ""}</span><span>{item.name}</span><b>{item.amount}</b></button>})}</section>)}</section>}

    <nav className="bottom-nav"><button className={tab === "plan" ? "selected" : ""} onClick={() => setTab("plan")}><span>▦</span>План</button><button className={tab === "recipes" ? "selected" : ""} onClick={() => setTab("recipes")}><span>♨</span>Рецепты</button><button className={tab === "shopping" ? "selected" : ""} onClick={() => setTab("shopping")}><span>🛒</span>Покупки</button></nav>
  </main>;
}

function RecipeView({ meal, onBack, days }: { meal: Meal; onBack: () => void; days: number }) {
  const [mode, setMode] = useState<"ingredients" | "steps">("ingredients");
  const [eaten, setEaten] = useState(false);
  return <main className="phone-shell recipe-view"><button className="back" onClick={onBack}>‹</button><div className="recipe-hero"><span>{meal.emoji}</span><p>{meal.time} · Можно заморозить</p><h1>{meal.title}</h1><div className="recipe-metrics"><span>{meal.kcal}<small>ккал</small></span><span>{meal.protein} г<small>белка</small></span><span>{days}<small>дня</small></span></div></div><section className="recipe-panel"><div className="segment"><button className={mode === "ingredients" ? "on" : ""} onClick={() => setMode("ingredients")}>Ингредиенты</button><button className={mode === "steps" ? "on" : ""} onClick={() => setMode("steps")}>Готовить</button></div>{mode === "ingredients" ? <><h2>На {days} дня · 2 человека</h2><div className="ingredient-list">{meal.ingredients.map((i) => <div key={i.name}><span>✓</span><p>{i.name}<small>{i.group}</small></p><b>{i.amount}</b></div>)}</div></> : <ol className="steps">{meal.steps.map(s => <li key={s}>{s}</li>)}</ol>}<button className={eaten ? "eaten complete" : "eaten"} onClick={() => setEaten(!eaten)}>{eaten ? "✓ Съедено" : "✓ Отметить как съеденное"}</button></section></main>;
}
