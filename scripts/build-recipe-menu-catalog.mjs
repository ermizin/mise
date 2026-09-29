import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateClientCatalog } from "./build-plan-recipe-registry.mjs";

/*
 * The catalogue by menu direction: which dishes a person is offered when they
 * choose «Простое», «Высокобелковое», «Бюджетное», «Веганское» or «Палео».
 * It is read from the client's own predicates, so the document cannot list a
 * dish the wizard would not offer, or miss one it would.
 */

const mealGroups = [
  { id: "breakfast", title: "Завтраки", slots: ["breakfast"] },
  { id: "main", title: "Обеды и ужины", slots: ["lunch", "dinner"] },
  { id: "snack", title: "Перекусы", slots: ["snack1", "snack2"] },
];
const slotWords = { breakfast: "завтрак", lunch: "обед", dinner: "ужин", snack1: "перекус", snack2: "перекус" };

const catalogExpression = `(() => {
  const offered = (recipe, style) =>
    recipe.tags.includes(style) && isAvailableForNewMenus(recipe) && !belongsToHiddenDietPlan(recipe);
  return {
    styles: releaseMenuStyles.map((style) => ({ id: style, label: styleMeta[style].label, description: styleMeta[style].description })),
    cuisineLabels,
    recipes: productionRecipes
      .filter((recipe) => releaseMenuStyles.some((style) => offered(recipe, style)))
      .map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        menus: releaseMenuStyles.filter((style) => offered(recipe, style)),
        slots: allMealSlots.filter((slot) => recipeSupportsSlot(recipe, slot)),
        cuisine: recipe.cuisine,
        macros: recipe.macros,
        time: recipe.time,
        storageDays: recipe.storageDays,
        freezable: recipe.freezable,
        hasPhoto: Boolean(recipe.provenance.imageUrl),
        viableCalories: (() => {
          const family = recipeFamilyFor(recipe);
          return family ? { min: family.minViableCalories, max: family.maxViableCalories } : null;
        })(),
      })),
  };
})()`;

const plain = (value) => JSON.parse(JSON.stringify(value));
const cell = (value) => String(value).replaceAll("|", "\\|");
const whole = (value) => Math.round(value);

export async function buildRecipeMenuCatalog() {
  const { styles, cuisineLabels, recipes } = plain(await evaluateClientCatalog(catalogExpression));
  const byTitle = (left, right) => left.title.localeCompare(right.title, "ru") || left.id.localeCompare(right.id);
  const menus = styles.map((style) => {
    const dishes = recipes.filter((recipe) => recipe.menus.includes(style.id));
    return {
      ...style,
      total: dishes.length,
      groups: mealGroups.map((group) => ({
        ...group,
        recipes: dishes.filter((recipe) => recipe.slots.some((slot) => group.slots.includes(slot))).sort(byTitle),
      })),
    };
  });
  return { menus, cuisineLabels, totalRecipes: recipes.length };
}

export function renderRecipeMenuCatalog({ menus, cuisineLabels, totalRecipes }) {
  const lines = [
    "# Каталог блюд по меню",
    "",
    "Документ собран скриптом `scripts/build-recipe-menu-catalog.mjs` из того же кода, по которому мастер плана предлагает блюда. Руками не редактируется: после изменения рецептов выполните `pnpm recipes:runtime:refresh`.",
    "",
    `Всего блюд, доступных для новых меню: **${totalRecipes}**. Одно блюдо может входить в несколько меню.`,
    "",
    "КБЖУ — на базовую порцию карточки; в плане порция пересчитывается под цель человека в пределах рабочего диапазона калорий.",
    "",
    "## Сводка",
    "",
    `| Меню | Всего | ${mealGroups.map((group) => group.title).join(" | ")} |`,
    `| --- | ---: | ${mealGroups.map(() => "---:").join(" | ")} |`,
    ...menus.map((menu) => `| ${menu.label} | ${menu.total} | ${menu.groups.map((group) => group.recipes.length).join(" | ")} |`),
    "",
  ];
  for (const menu of menus) {
    lines.push(`## ${menu.label}`, "", `${menu.description}. Блюд: ${menu.total}.`, "");
    for (const group of menu.groups) {
      if (!group.recipes.length) continue;
      lines.push(
        `### ${menu.label}: ${group.title.toLowerCase()} (${group.recipes.length})`,
        "",
        "| Блюдо | Приём пищи | ккал | Б | Ж | У | Диапазон, ккал | Время, мин | Холодильник, дней | Заморозка | Кухня | Фото | Код |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- | --- | --- |",
        ...group.recipes.map((recipe) => {
          const meals = [...new Set(recipe.slots.filter((slot) => group.slots.includes(slot)).map((slot) => slotWords[slot]))].join(", ");
          const range = recipe.viableCalories ? `${recipe.viableCalories.min}–${recipe.viableCalories.max}` : "—";
          return `| ${[
            cell(recipe.title), meals, whole(recipe.macros.kcal), whole(recipe.macros.protein), whole(recipe.macros.fat), whole(recipe.macros.carbs),
            range, recipe.time, recipe.storageDays, recipe.freezable ? "да" : "нет", cuisineLabels[recipe.cuisine] ?? recipe.cuisine,
            recipe.hasPhoto ? "есть" : "нет", `\`${recipe.id}\``,
          ].join(" | ")} |`;
        }),
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? pathToFileURL(resolve(process.argv[outputIndex + 1])) : new URL("../docs/recipe-catalog.md", import.meta.url);
  const catalog = await buildRecipeMenuCatalog();
  await writeFile(output, renderRecipeMenuCatalog(catalog));
  console.log(JSON.stringify({
    recipes: catalog.totalRecipes,
    byMenu: Object.fromEntries(catalog.menus.map((menu) => [menu.id, menu.total])),
  }));
}
