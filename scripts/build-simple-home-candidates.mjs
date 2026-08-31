import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalIngredients } from "../domain/recipe-engine.ts";

const gram = (id, displayNameRu, amountMetric) => ({
  id,
  name: displayNameRu,
  displayNameRu,
  amountMetric,
  unitMetric: "g",
  original: `${amountMetric} г · адаптация Mise`,
});

const microNames = new Map([
  ["Соль", "salt"], ["Чёрный перец", "black pepper"], ["Белый перец", "white pepper"],
  ["Паприка", "paprika"], ["Корица", "cinnamon"], ["Укроп", "dill"], ["Зелень", "dill"],
  ["Тимьян", "thyme"], ["Шалфей", "sage"], ["Розмарин", "rosemary"], ["Специи", "paprika"],
]);
const micro = (displayNameRu, original = "по вкусу") => ({
  name: microNames.get(displayNameRu) ?? displayNameRu,
  displayNameRu,
  original,
});

const measuredEditorial = (name, displayNameRu, amountMetric, unitMetric = "g") => ({
  name,
  displayNameRu,
  amountMetric,
  unitMetric,
  original: `${amountMetric} ${unitMetric} · редакционное решение Mise`,
});

const configs = [
  {
    id: "new-home-buckwheat-legs", titleRu: "Гречка с куриными ножками и йогуртовым соусом", slot: "dinner", servings: 6, totalMinutes: 80,
    ingredients: [gram("chicken_thigh_raw", "Куриные голени, мясная часть", 1080), gram("buckwheat_raw", "Гречка", 360), gram("carrot_raw", "Морковь", 200), gram("onion_raw", "Лук", 180), gram("pepper_raw", "Сладкий перец", 150), gram("zucchini_raw", "Кабачок", 250), gram("tomato_raw", "Помидор", 180), gram("olive_oil_processed", "Оливковое масло", 20), gram("mustard_processed", "Горчица", 25), gram("yogurt_processed", "Греческий йогурт для соуса", 300), gram("garlic_raw", "Чеснок", 15), micro("Соль"), micro("Паприка")],
    steps: ["Смешайте ножки с горчицей, паприкой, половиной чеснока и солью.", "Овощи слегка обжарьте, переложите в форму, добавьте промытую гречку и 720 мл кипятка.", "Разложите ножки сверху и запекайте под фольгой 50–60 минут при 180°C, до 74°C в центре мяса.", "Смешайте йогурт с оставшимся чесноком и разлейте соус по отдельным ёмкостям."], adaptation: "Добавлен отдельный йогуртовый соус; мясная порция усилена."
  },
  {
    id: "new-home-cutlets-mash", titleRu: "Куриные котлеты с пюре и быстрым соусом", slot: "dinner", servings: 4, totalMinutes: 45,
    ingredients: [gram("chicken_mince_raw", "Куриный фарш", 720), gram("breadcrumbs_processed", "Панировочные сухари", 40), gram("egg_raw", "Яйцо", 60), gram("onion_raw", "Лук", 100), gram("potato_raw", "Картофель", 800), gram("milk_processed", "Молоко", 160), gram("butter_processed", "Сливочное масло", 20), gram("yogurt_processed", "Греческий йогурт", 200), gram("mustard_processed", "Дижонская горчица", 20), gram("soy_processed", "Соевый соус", 20), micro("Соль"), micro("Чёрный перец")],
    steps: ["Смешайте фарш, яйцо, сухари, мелко нарезанный лук и специи; сформуйте 8 котлет.", "Обжарьте по 3–4 минуты с каждой стороны, затем доведите под крышкой до 74°C внутри.", "Отварите картофель, разомните с молоком и маслом.", "Смешайте йогурт, горчицу и соевый соус; упакуйте отдельно."], adaptation: "Долгое тушение заменено быстрым доведением под крышкой; котлеты и пюре раскрыты в измеримый состав."
  },
  {
    id: "new-home-merchant-buckwheat", titleRu: "Гречка по-купечески с курицей", slot: "lunch", servings: 4, totalMinutes: 40,
    ingredients: [gram("chicken_raw", "Куриное филе", 700), gram("buckwheat_raw", "Гречка", 280), gram("onion_raw", "Лук", 120), gram("carrot_raw", "Морковь", 160), gram("tomato_paste_processed", "Томатная паста", 50), gram("vegetable_oil_processed", "Растительное масло", 20), gram("garlic_raw", "Чеснок", 10), micro("Соль"), micro("Паприка")],
    steps: ["Нарежьте курицу и обжарьте до лёгкой корочки.", "Добавьте лук, морковь, чеснок и томатную пасту; готовьте 4–5 минут.", "Всыпьте промытую гречку, влейте 560 мл воды и тушите под крышкой 15–18 минут."], adaptation: "Полный состав восстановлен; курицы 175 г на порцию."
  },
  {
    id: "new-home-simple-buckwheat", titleRu: "Простая гречка с курицей", slot: "lunch", servings: 4, totalMinutes: 40,
    ingredients: [gram("chicken_raw", "Куриное филе", 700), gram("buckwheat_raw", "Гречка", 280), gram("tomato_raw", "Помидор", 180), gram("onion_raw", "Лук", 120), gram("tomato_paste_processed", "Томатная паста", 50), gram("garlic_raw", "Чеснок", 10), micro("Соль"), micro("Укроп")],
    steps: ["Обжарьте лук и чеснок 3 минуты, затем добавьте помидор и томатную пасту.", "Добавьте кусочки курицы и готовьте до лёгкой корочки.", "Всыпьте промытую гречку, влейте 560 мл воды и тушите под крышкой до готовности крупы и курицы."], adaptation: "Белковая порция курицы увеличена без усложнения рецепта."
  },
  {
    id: "new-home-stewed-cabbage", titleRu: "Тушёная капуста со свиной вырезкой", slot: "dinner", servings: 4, totalMinutes: 65,
    ingredients: [gram("pork_fillet_raw", "Свиная вырезка", 700), gram("cabbage_raw", "Капуста", 800), gram("potato_raw", "Картофель", 400), gram("carrot_raw", "Морковь", 120), gram("ketchup_processed", "Кетчуп", 80), gram("vegetable_oil_processed", "Растительное масло", 20), micro("Соль"), micro("Чёрный перец"), micro("Зелень")],
    steps: ["Обжарьте морковь и кусочки свинины 8–10 минут.", "Влейте 150 мл воды и тушите под крышкой 15 минут.", "Добавьте картофель, капусту, кетчуп и ещё 150 мл воды; тушите 20–25 минут до мягкости овощей."], adaptation: "Вместо неопределённой свинины взята постная вырезка; 175 г на порцию."
  },

  ...[
    ["new-oats-banana-blueberry", "Ночная овсянка с бананом и черникой", [gram("banana_raw", "Банан", 100), gram("berries_raw", "Черника", 100), gram("walnuts_raw", "Пекан или грецкий орех", 10)], "Добавлено 30 г протеина, как просил владелец."],
    ["new-oats-chocolate", "Шоколадная ночная овсянка", [gram("cocoa_processed", "Какао", 8), gram("dark_chocolate_processed", "Тёмный шоколад, порубить", 15)], "Шоколад оставлен обычной рубленой плиткой; добавлен протеин."],
    ["new-oats-apple", "Ночная овсянка «Яблочный пирог»", [gram("apple_raw", "Яблоко", 150), gram("walnuts_raw", "Грецкий орех", 10)], "Белковая основа из йогурта и протеина; кленовый сироп не нужен."],
    ["new-oats-carrot", "Ночная овсянка «Морковный торт»", [gram("carrot_raw", "Морковь", 80), gram("walnuts_raw", "Грецкий орех", 10)], "Жирное кокосовое молоко заменено обычным; добавлен протеин."],
    ["new-oats-blueberry-almond", "Ночная овсянка с черникой и миндалём", [gram("berries_raw", "Черника", 100), gram("almonds_raw", "Миндаль", 15), gram("applesauce_processed", "Яблочное пюре без сахара", 100)], "Сохранён низкосахарный профиль; добавлен протеин."],
    ["new-oats-cinnamon-raisin", "Ночная овсянка с корицей и изюмом", [gram("raisins_processed", "Изюм", 20), gram("banana_raw", "Банан", 80), gram("walnuts_raw", "Грецкий орех", 10)], "Добавлен протеин; изюм оставлен малой вкусовой добавкой."],
  ].map(([id, titleRu, additions, adaptation]) => ({
    id, titleRu, slot: "breakfast", servings: 1, totalMinutes: 485,
    ingredients: [gram("oats_raw", "Овсяные хлопья", 50), gram("milk_processed", "Молоко 2%", 150), gram("yogurt_processed", "Греческий йогурт", 100), gram("protein_powder_processed", "Протеин с нейтральным или ванильным вкусом", 25), ...additions, micro("Корица")],
    steps: ["Смешайте молоко, йогурт и протеин до однородности.", "Добавьте овсяные хлопья и вкусовые добавки, перемешайте.", "Закройте и уберите в холодильник на 6–8 часов; перемешайте перед едой."], adaptation,
  })),

  ...[
    ["new-sandwich-boiled-chicken", "Сэндвич с варёной курицей и zero-соусом", "chicken_raw", "Варёная куриная грудка", 150, [gram("tomato_raw", "Помидор", 80), gram("cheese_processed", "Сыр", 20)]],
    ["new-sandwich-smoked-chicken", "Сэндвич с копчёной курицей и яйцом", "chicken_thigh_raw", "Копчёная курица без кожи, масса мяса; сверить этикетку", 150, [gram("egg_raw", "Варёное яйцо", 60), gram("tomato_raw", "Помидор", 60)]],
    ["new-sandwich-turkey-ham", "Сэндвич с ветчиной из индейки", "ham_steak_processed", "Ветчина из индейки с белком от 18 г/100 г; сверить этикетку", 130, [gram("cheese_processed", "Сыр", 20), gram("tomato_raw", "Помидор", 60), gram("cucumber_raw", "Огурец", 60)]],
    ["new-sandwich-balyk", "Простой сэндвич с балыком", "ham_steak_processed", "Нежирный балык с белком от 18 г/100 г; сверить этикетку", 130, [gram("tomato_raw", "Помидоры черри", 80), gram("cottage_processed", "Творожная намазка", 50)]],
    ["new-sandwich-caesar", "Открытый сэндвич «Цезарь» с курицей", "chicken_raw", "Куриная грудка", 160, [gram("yogurt_processed", "Греческий йогурт для соуса", 50), gram("parmesan_processed", "Пармезан", 15), gram("lettuce_raw", "Салат романо", 50)]],
    ["new-sandwich-paprika", "Чиабатта с курицей и копчёной паприкой", "chicken_raw", "Куриная грудка", 160, [gram("yogurt_processed", "Греческий йогурт для соуса", 50), gram("lettuce_raw", "Салат романо", 50)]],
  ].map(([id, titleRu, proteinId, proteinName, proteinGrams, additions]) => ({
    id, titleRu, slot: "breakfast", servings: 1, totalMinutes: 20,
    ingredients: [gram("bread_processed", id === "new-sandwich-paprika" ? "Чиабатта" : "Цельнозерновой хлеб", 90), gram(proteinId, proteinName, proteinGrams), ...additions, gram("dressing_processed", "Низкокалорийный zero-соус, сверить этикетку", 15), micro("Чёрный перец")],
    steps: ["Подсушите хлеб; мясо нарежьте тонкими ломтиками.", "Выложите на хлеб овощи и всю белковую порцию.", "Добавьте 15 г zero-соуса и соберите сэндвич непосредственно перед едой."],
    adaptation: "Белковая начинка 130–160 г; соус указан как zero-продукт с обязательной сверкой этикетки.",
  })),

  {
    id: "foodru-oblomov-potato-mushroom", titleRu: "Картофель с грибным соусом и курицей", slot: "dinner", servings: 5, totalMinutes: 60,
    ingredients: [gram("chicken_raw", "Куриная грудка", 900), gram("potato_raw", "Картофель", 1200), gram("mushrooms_raw", "Шампиньоны", 600), gram("onion_raw", "Лук", 300), gram("sour_cream_processed", "Сметана", 250), gram("mushrooms_dried_processed", "Сухой грибной порошок", 15), gram("butter_processed", "Сливочное масло", 30), gram("vegetable_oil_processed", "Растительное масло", 20), gram("garlic_raw", "Чеснок", 20), micro("Тимьян"), micro("Соль")],
    steps: ["Картофель нарежьте и запеките до румяности при 210°C.", "Курицу обжарьте порционными кусочками до 74°C внутри.", "Обжарьте лук и грибы, добавьте чеснок, грибной порошок и сметану; прогрейте до густого соуса.", "Упакуйте курицу, картофель и соус вместе."], adaptation: "По решению владельца добавлено 180 г курицы на порцию; масло и сметана сокращены."
  },

  ...[
    ["foodru-oblomov-meatballs", "Славные фрикадельки с пастой", 5, 55, [gram("chicken_thigh_raw", "Мясо куриного бедра", 900), gram("pasta_raw", "Спагетти", 350), gram("tomato_passata_processed", "Протёртые томаты", 800), gram("breadcrumbs_processed", "Панировочные сухари", 100), gram("parmesan_processed", "Пармезан", 80), gram("egg_raw", "Яйца", 120), gram("onion_raw", "Лук", 180), gram("carrot_raw", "Морковь", 150), gram("celery_raw", "Стебель сельдерея", 120)], "Исходная белковая основа сохранена; паста нормирована до 70 г сухой на порцию."],
    ["foodru-oblomov-chicken-legs", "Славные куриные ножки с йогуртовым соусом", 6, 60, [gram("chicken_thigh_raw", "Куриные голени, мясная часть", 1440), gram("yogurt_processed", "Греческий йогурт", 300), gram("mayonnaise_processed", "Майонез", 50), gram("pickles_processed", "Солёные огурцы", 90), gram("lime_juice_raw", "Сок лайма", 40), gram("hot_sauce_processed", "Шрирача", 15), gram("vegetable_oil_processed", "Растительное масло", 20)], "Майонез и сахар в соусе сильно сокращены; основа соуса — йогурт."],
    ["foodru-oblomov-beef-veg", "Славное мясо с овощами", 6, 160, [gram("beef_stewing_raw", "Говядина для тушения", 1200), gram("broth_processed", "Говяжий бульон", 1200), gram("onion_raw", "Лук", 300), gram("carrot_raw", "Морковь", 300), gram("pepper_raw", "Сладкий перец", 300), gram("tomato_paste_processed", "Томатная паста", 50), gram("garlic_raw", "Чеснок", 30)], "Кости не входят в массу порции: в адаптации указан готовый бульон и 200 г сырой говядины на порцию."],
    ["foodru-oblomov-chashushuli", "Славные чашушули", 12, 200, [gram("beef_stewing_raw", "Говядина для тушения", 2400), gram("pepper_raw", "Сладкий перец", 600), gram("onion_raw", "Лук", 400), gram("tomato_raw", "Помидор", 600), gram("tomato_paste_processed", "Томатная паста", 90), gram("butter_processed", "Сливочное масло", 50), gram("garlic_raw", "Чеснок", 40)], "Белковая порция 200 г сырой говядины; масло и сахар сокращены."],
    ["foodru-oblomov-borscht", "Славный борщ с увеличенной порцией мяса", 10, 120, [gram("beef_stewing_raw", "Говядина", 1600), gram("broth_processed", "Говяжий бульон", 2500), gram("cabbage_raw", "Капуста", 900), gram("beetroot_cooked_cooked", "Свёкла", 400), gram("carrot_raw", "Морковь", 300), gram("onion_raw", "Лук", 200), gram("celery_raw", "Сельдерей", 300), gram("tomato_paste_processed", "Томатная паста", 90), gram("garlic_raw", "Чеснок", 30), gram("lemon_raw", "Лимонный сок", 40)], "Выход сокращён до 10 порций, чтобы в каждой было 160 г сырой говядины."],
    ["foodru-oblomov-pepper-beef", "Славная перечная говядина с подливой", 6, 70, [gram("beef_stewing_raw", "Говядина для тушения", 1200), gram("onion_raw", "Лук", 600), gram("wheat_flour_raw", "Цельнозерновая мука", 60), gram("butter_processed", "Сливочное масло", 40), gram("garlic_raw", "Чеснок", 30)], "Исходная порция мяса уже высокобелковая; соус сохранён."],
    ["foodru-oblomov-pepper-chicken", "Славная перечная курица с подливой", 6, 60, [gram("chicken_raw", "Куриная грудка", 1200), gram("onion_raw", "Лук", 600), gram("wheat_flour_raw", "Цельнозерновая мука", 60), gram("butter_processed", "Сливочное масло", 40), gram("garlic_raw", "Чеснок", 30)], "Отдельная куриная версия по прямой просьбе владельца."],
    ["foodru-oblomov-ginger-pork", "Славная имбирная свинина", 6, 40, [gram("pork_fillet_raw", "Свиная вырезка", 1200), gram("onion_raw", "Лук", 240), gram("starch_processed", "Крахмал", 60), gram("soy_processed", "Соевый соус", 100), gram("ginger_raw", "Имбирь", 30), gram("garlic_raw", "Чеснок", 20), gram("honey_processed", "Мёд", 30), gram("white_sugar_processed", "Сахар", 20), gram("lemon_raw", "Лимонный сок", 36)], "Сахар, мёд и крахмал сокращены; свинина заменена постной вырезкой."],
    ["foodru-oblomov-ginger-chicken", "Славная имбирная курица", 6, 40, [gram("chicken_raw", "Куриная грудка", 1200), gram("onion_raw", "Лук", 240), gram("starch_processed", "Крахмал", 60), gram("soy_processed", "Соевый соус", 100), gram("ginger_raw", "Имбирь", 30), gram("garlic_raw", "Чеснок", 20), gram("honey_processed", "Мёд", 30), gram("white_sugar_processed", "Сахар", 20), gram("lemon_raw", "Лимонный сок", 36)], "Отдельная куриная версия по прямой просьбе владельца; сладкая часть соуса сокращена."],
  ].map(([id, titleRu, servings, totalMinutes, ingredients, adaptation]) => ({
    id, sourceId: id.endsWith("-chicken") ? id.replace("-chicken", id.includes("pepper") ? "-beef" : "-pork") : id, titleRu, slot: "dinner", servings, totalMinutes, ingredients: [...ingredients, micro("Соль"), micro("Чёрный перец")],
    steps: ["Нарежьте мясо и овощи, отмерьте компоненты соуса.", "Обжарьте мясо партиями до румяной корочки, затем добавьте овощи.", "Введите остальные ингредиенты и тушите до мягкости мяса; курица должна достичь 74°C в центре.", "Разделите блюдо на равные порции вместе с соусом."], adaptation,
  })),

  {
    id: "foodru-oblomov-seabass", titleRu: "Славный сибас с картофелем", slot: "dinner", servings: 4, totalMinutes: 70,
    ingredients: [gram("cod_raw", "Филе сибаса или другой белой рыбы", 800), gram("potato_raw", "Картофель", 1000), gram("parmesan_processed", "Пармезан", 100), gram("butter_processed", "Сливочное масло", 40), gram("garlic_raw", "Чеснок", 20), micro("Шалфей"), micro("Соль"), micro("Белый перец")],
    steps: ["Филе рыбы проверьте на кости, картофель и чеснок нарежьте тонкими ломтиками.", "Выложите в форму слои картофеля, шалфея, чеснока, рыбы и пармезана; между слоями добавьте масло.", "Накройте фольгой и запекайте 35–40 минут при 200°C, затем откройте и подрумяньте 5–10 минут."], adaptation: "Количество масла и пармезана сокращено; для расчёта КБЖУ сибас ведётся как нежирная белая рыба."
  },
  {
    id: "foodru-oblomov-sandwich", titleRu: "Славный бутерброд с курицей и авокадо", slot: "lunch", servings: 2, totalMinutes: 25,
    ingredients: [gram("chicken_thigh_raw", "Куриное бедро без кожи", 400), gram("bread_processed", "Циабатта", 160), gram("avocado_raw", "Авокадо", 100), gram("tomato_raw", "Помидор", 100), gram("onion_raw", "Красный лук", 40), gram("lettuce_raw", "Салат", 40), gram("soy_processed", "Соевый соус", 20), gram("lime_juice_raw", "Сок лайма", 20), gram("vegetable_oil_processed", "Растительное масло", 10), gram("garlic_raw", "Чеснок", 5), micro("Паприка")],
    steps: ["Замаринуйте курицу в соевом соусе с паприкой на 10 минут.", "Обжарьте курицу до 74°C в центре и дайте отдохнуть 5 минут.", "Разомните авокадо с лаймом, помидором и луком.", "Подсушите хлеб и соберите бутерброд перед едой."], adaptation: "Масло сокращено; курицы 200 г на порцию."
  },

  ...[
    ["foodru-blogger-chicken-bombs", "Куриные «бомбочки» с рисом и жюльеном", 5, 65, [gram("chicken_thigh_raw", "Мясо куриного бедра", 900), gram("rice_raw", "Рис", 250), gram("mushrooms_raw", "Шампиньоны", 150), gram("onion_raw", "Лук", 80), gram("sour_cream_processed", "Сметана 15%", 100), gram("tomato_paste_processed", "Томатная паста", 30), gram("vegetable_oil_processed", "Растительное масло", 10), gram("garlic_raw", "Чеснок", 5)], "Исходная белковая порция достаточна; сметана и масло нормированы."],
    ["foodru-blogger-stuffed-pepper", "Фаршированный перец «Чистые ручки»", 4, 55, [gram("pepper_raw", "Болгарский перец", 650), gram("beef_mince_raw", "Говяжий фарш", 200), gram("chicken_raw", "Куриная грудка", 250), gram("chicken_thigh_raw", "Куриное бедро без кожи", 150), gram("rice_raw", "Рис", 100), gram("onion_raw", "Лук", 120), gram("tomato_paste_processed", "Томатная паста", 40)], "Выход сокращён до 4 порций, а мясная начинка увеличена до 150 г на порцию."],
    ["foodru-blogger-cottage-waffles", "Творожные вафли с яблоком", 4, 30, [gram("cottage_processed", "Творог 4–5%", 500), gram("protein_powder_processed", "Протеин", 60), gram("cornmeal_raw", "Кукурузная мука", 60), gram("egg_raw", "Яйца", 120), gram("apple_raw", "Яблоко", 150)], "Выход сокращён до 4 порций; добавлено 60 г протеина на партию."],
  ].map(([id, titleRu, servings, totalMinutes, ingredients, adaptation]) => ({
    id, titleRu, slot: id.includes("waffles") ? "breakfast" : "dinner", servings, totalMinutes, ingredients: [...ingredients, micro("Соль"), micro("Специи")],
    steps: id.includes("waffles")
      ? ["Пробейте творог, яйца и протеин до однородности.", "Вмешайте кукурузную муку и мелко нарезанное яблоко.", "Выпекайте в разогретой вафельнице до устойчивой золотистой корочки."]
      : ["Подготовьте овощи, крупу и мясную начинку по указанным массам.", "Соберите порционные заготовки, равномерно распределяя мясо и гарнир.", "Доведите блюдо под крышкой или в духовке до 74°C в центре курицы и мягкости крупы.", "Остудите и разделите на равные контейнеры."],
    adaptation,
  })),

  ...[
    ["foodru-oats-chocolate-shell", "Ленивая овсянка с шоколадной корочкой", [gram("banana_raw", "Банан", 100), gram("walnuts_raw", "Грецкий орех", 10), gram("dark_chocolate_processed", "Тёмный шоколад", 20)], "Шоколад сокращён с 45 до 20 г; добавлено 30 г протеина."],
    ["foodru-oats-no-cook", "Нежная овсянка без варки", [gram("banana_raw", "Банан", 100), gram("cocoa_processed", "Какао", 8)], "Добавлены йогурт и 30 г протеина; банан нормирован до 100 г."],
  ].map(([id, titleRu, additions, adaptation]) => ({
    id, titleRu, slot: "breakfast", servings: 1, totalMinutes: 485,
    ingredients: [gram("oats_raw", "Овсяные хлопья", 50), gram("milk_processed", "Молоко 2%", 150), gram("yogurt_processed", "Греческий йогурт", 100), gram("protein_powder_processed", "Протеин", 25), ...additions],
    steps: ["Смешайте молоко, йогурт и протеин до однородности.", "Добавьте овсянку и остальные добавки; шоколад для корочки растопите отдельно.", "Закройте банку и оставьте в холодильнике на 6–8 часов."], adaptation,
  })),
  {
    id: "foodru-oats-tomato", titleRu: "Томатная овсянка с яйцом и пармезаном", slot: "breakfast", servings: 2, totalMinutes: 30,
    ingredients: [gram("oats_raw", "Овсяные хлопья", 100), gram("milk_processed", "Молоко", 250), gram("tomato_passata_processed", "Протёртые томаты", 200), gram("egg_raw", "Яйца", 120), gram("egg_white_raw", "Яичные белки", 300), gram("parmesan_processed", "Пармезан", 20), gram("olive_oil_processed", "Оливковое масло", 5), gram("garlic_raw", "Чеснок", 5), micro("Розмарин"), micro("Соль")],
    steps: ["Прогрейте чеснок и розмарин в масле, добавьте томаты и молоко.", "Всыпьте овсянку и варите до мягкости.", "Яйца и белки приготовьте без жидкого белка, выложите на кашу и посыпьте пармезаном."], adaptation: "Добавлено 150 г яичного белка на порцию."
  },
  {
    id: "foodru-oats-chicken", titleRu: "Овсянка с куриным филе", slot: "breakfast", servings: 2, totalMinutes: 40,
    ingredients: [gram("oats_raw", "Овсяные хлопья", 100), gram("chicken_raw", "Куриное филе", 300), gram("onion_raw", "Лук", 60), gram("carrot_raw", "Морковь", 50), gram("sunflower_oil_processed", "Подсолнечное масло", 10), micro("Соль")],
    steps: ["Овсянку залейте 250 мл воды и сварите до мягкости.", "Курицу, лук и морковь нарежьте и обжарьте в минимуме масла.", "Добавьте 100 мл воды и тушите до 74°C в центре курицы; выложите на кашу."], adaptation: "Курица увеличена до 150 г на порцию, масло сокращено до 5 г."
  },
];

const titleOverrides = new Map(Object.entries({
  "new-home-buckwheat-legs": "Гречка с куриными бёдрами и йогуртовым соусом",
  "foodru-oblomov-meatballs": "Фрикадельки с пастой",
  "foodru-oblomov-chicken-legs": "Куриные бёдра с йогуртовым соусом",
  "foodru-oblomov-beef-veg": "Мясо с овощами",
  "foodru-oblomov-chashushuli": "Чашушули",
  "foodru-oblomov-borscht": "Борщ с увеличенной порцией мяса",
  "foodru-oblomov-pepper-beef": "Перечная говядина с подливой",
  "foodru-oblomov-pepper-chicken": "Перечная курица с подливой",
  "foodru-oblomov-ginger-pork": "Имбирная свинина",
  "foodru-oblomov-ginger-chicken": "Имбирная курица",
  "foodru-oblomov-seabass": "Сибас с картофелем",
  "foodru-oblomov-sandwich": "Бутерброд с курицей и авокадо",
}));

const overnightFlavourSteps = new Map(Object.entries({
  "new-oats-banana-blueberry": "Добавьте овсяные хлопья, банан, чернику и грецкие орехи, перемешайте.",
  "new-oats-chocolate": "Добавьте овсяные хлопья, какао и рубленый тёмный шоколад, перемешайте.",
  "new-oats-apple": "Добавьте овсяные хлопья, мелко нарезанное яблоко, корицу и грецкие орехи, перемешайте.",
  "new-oats-carrot": "Добавьте овсяные хлопья, мелко натёртую морковь, корицу и грецкие орехи, перемешайте.",
  "new-oats-blueberry-almond": "Добавьте овсяные хлопья, чернику, миндаль и яблочное пюре, перемешайте.",
  "new-oats-cinnamon-raisin": "Добавьте овсяные хлопья, изюм, размятый банан, корицу и грецкие орехи, перемешайте.",
  "foodru-oats-chocolate-shell": "Добавьте овсянку, банан и грецкие орехи; растопите тёмный шоколад и распределите его сверху тонким слоем.",
  "foodru-oats-no-cook": "Добавьте овсянку, размятый банан и какао, перемешайте.",
}));

const overnightAdaptations = new Map(Object.entries({
  "new-oats-banana-blueberry": "Добавлено 25 г протеина на порцию.",
  "new-oats-chocolate": "Шоколад оставлен обычной рубленой плиткой; добавлено 25 г протеина на порцию.",
  "new-oats-apple": "Белковая основа из йогурта и 25 г протеина; кленовый сироп не нужен.",
  "new-oats-carrot": "Жирное кокосовое молоко заменено обычным; добавлено 25 г протеина на порцию.",
  "new-oats-blueberry-almond": "Сохранён низкосахарный профиль; добавлено 25 г протеина на порцию.",
  "new-oats-cinnamon-raisin": "Добавлено 25 г протеина; изюм оставлен малой вкусовой добавкой.",
  "foodru-oats-chocolate-shell": "Шоколад сокращён с 45 до 20 г; добавлено 25 г протеина на порцию.",
  "foodru-oats-no-cook": "Добавлены йогурт и 25 г протеина; банан нормирован до 100 г.",
}));

function applyFinalReviewResolution(input) {
  const config = structuredClone(input);
  config.titleRu = titleOverrides.get(config.id) ?? config.titleRu;

  if (config.id === "new-home-buckwheat-legs") {
    config.steps = config.steps.map((step) => step.replace(/ножки/giu, "бёдра"));
  }

  if (overnightFlavourSteps.has(config.id)) {
    config.steps[0] = "Смешайте молоко, йогурт и 25 г протеинового порошка до однородности.";
    config.steps[1] = overnightFlavourSteps.get(config.id);
    config.adaptation = overnightAdaptations.get(config.id);
  }

  const sandwichProteinNames = new Map(Object.entries({
    "new-sandwich-boiled-chicken": "Куриная грудка, варёная",
    "new-sandwich-smoked-chicken": "Копчёная курица без кожи",
    "new-sandwich-turkey-ham": "Ветчина из индейки",
    "new-sandwich-balyk": "Балык",
  }));
  if (config.id.startsWith("new-sandwich-")) {
    const proteinName = sandwichProteinNames.get(config.id);
    if (proteinName) {
      const protein = config.ingredients[1];
      protein.name = proteinName;
      protein.displayNameRu = proteinName;
    }
    const sauce = config.ingredients.find((ingredient) => ingredient.id === "dressing_processed");
    sauce.name = "Низкокалорийный zero-соус";
    sauce.displayNameRu = "Низкокалорийный zero-соус";
    config.adaptation = "Белковая начинка 130–160 г; 15 г низкокалорийного zero-соуса с обязательной сверкой этикетки.";
  }

  if (["foodru-oblomov-beef-veg", "foodru-oblomov-chashushuli", "foodru-oblomov-borscht"].includes(config.id)) {
    config.steps = config.steps.map((step) => step.replace(/курица должна достичь 74°C в центре/giu, "говядина должна стать мягкой"));
  }
  if (config.id === "foodru-oblomov-ginger-pork") {
    config.steps = config.steps.map((step) => step.replace(/курица должна достичь 74°C в центре/giu, "свинина должна полностью приготовиться"));
  }

  if (["foodru-oblomov-pepper-beef", "foodru-oblomov-pepper-chicken"].includes(config.id)) {
    config.ingredients = config.ingredients.filter((ingredient) => ingredient.name !== "black pepper");
    config.ingredients.push(
      measuredEditorial("water", "Вода", 1500, "ml"),
      measuredEditorial("black peppercorns", "Чёрный перец горошком", 7.8),
    );
    const beef = config.id.endsWith("-beef");
    config.macroOverride = beef
      ? { kcal: 409, protein: 43.4, fat: 18.2, carbs: 19.4 }
      : { kcal: 375, protein: 47.6, fat: 10.9, carbs: 19.4 };
    config.steps = beef
      ? [
          "Нарежьте говядину, лук и чеснок; отмерьте муку, масло, перец и 250 мл воды на порцию.",
          "Обжарьте говядину партиями до румяной корочки, добавьте лук и чеснок. Влейте воду, добавьте перец и тушите под крышкой 45–50 минут до мягкости мяса.",
          "Разотрите масло с мукой, постепенно вмешайте горячую жидкость из кастрюли, верните подливу к мясу и готовьте ещё 5–7 минут до загустения.",
          "Разделите говядину и подливу на равные порции.",
        ]
      : [
          "Нарежьте курицу, лук и чеснок; отмерьте муку, масло, перец и 250 мл воды на порцию.",
          "Обжарьте курицу партиями до румяной корочки, добавьте лук и чеснок. Влейте воду, добавьте перец и готовьте под крышкой до 74°C в центре курицы.",
          "Разотрите масло с мукой, постепенно вмешайте горячую жидкость из сковороды, верните подливу к курице и готовьте ещё 5–7 минут до загустения.",
          "Разделите курицу и подливу на равные порции.",
        ];
    config.adaptation = beef
      ? "КБЖУ пересчитаны на одну порцию с 200 г сырой говядины; показатели источника относятся к 100 г сырой смеси. Вода не добавляет калорий."
      : "Куриная версия пересчитана отдельно; жидкость и перец сохранены в измеримом составе, вода не добавляет калорий.";
  }

  return config;
}

function round(value, precision = 1) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function nutritionFor(config) {
  if (config.macroOverride) return config.macroOverride;
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const ingredient of config.ingredients) {
    if (!ingredient.id) continue;
    const canonical = canonicalIngredients[ingredient.id];
    if (!canonical) throw new Error(`${config.id}: unknown canonical ingredient ${ingredient.id}`);
    for (const key of Object.keys(total)) total[key] += canonical.nutritionPer100g[key] * Number(ingredient.amountMetric) / 100;
  }
  return Object.fromEntries(Object.entries(total).map(([key, value]) => [key, round(value / config.servings)]));
}

const safeStorage = (config) => {
  const refrigeratorDays = config.slot === "breakfast" && config.id.includes("oats") ? 4 : config.id.includes("sandwich") ? 2 : config.id.includes("seabass") ? 2 : 3;
  return {
    refrigeratorDays,
    freezerDays: 0,
    freezable: false,
    coolWithinHours: 2,
    reheatToC: config.slot === "breakfast" && (config.id.includes("oats") || config.id.includes("sandwich")) ? null : 74,
    refrigerator: `До ${refrigeratorDays} суток при температуре не выше 4°C.`,
    freezer: "Заморозка для этой редакционной карточки не подтверждена.",
    thaw: "Не требуется.",
    reheat: config.slot === "breakfast" && (config.id.includes("oats") || config.id.includes("sandwich")) ? "Можно есть холодным; подогрев по желанию." : "Разогреть до 74°C в центре порции.",
    reference: "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/leftovers-and-food-safety",
  };
};

export async function buildSimpleHomeCandidates({ cwd = process.cwd() } = {}) {
  const extract = JSON.parse(await readFile(resolve(cwd, "data/simple-home-source-extract.json"), "utf8"));
  const approval = JSON.parse(await readFile(resolve(cwd, "data/simple-home-runtime-approval.json"), "utf8"));
  const approvedIds = new Set(approval.approvedRecipeIds ?? []);
  if (approval.schemaVersion !== 1 || approvedIds.size !== 34) {
    throw new Error("Simple-home runtime approval must contain exactly 34 unique approved recipes.");
  }
  const sources = new Map(extract.records.map((record) => [record.id, record]));
  const candidates = configs.filter((config) => approvedIds.has(config.id)).map(applyFinalReviewResolution).map((config) => {
    const source = sources.get(config.sourceId ?? config.id);
    if (!source) throw new Error(`${config.id}: source extract is missing`);
    const macros = nutritionFor(config);
    if (macros.protein < 25) throw new Error(`${config.id}: high-protein adaptation has only ${macros.protein} g protein`);
    const steps = config.steps.map((text, index) => ({ id: `editorial-step-${index + 1}`, text, ingredientIds: config.ingredients.map((_, ingredientIndex) => `source-ingredient-${ingredientIndex + 1}`), action: index === config.steps.length - 1 ? "portion" : "cook", dependsOn: index ? [`editorial-step-${index}`] : [] }));
    return {
      id: config.id,
      title: config.titleRu,
      titleRu: config.titleRu,
      sourceTitle: source.source.title,
      sourceUrl: source.source.url,
      sourceQuery: "owner-reviewed simple home and curated Food.ru recipe",
      imageUrl: source.source.imageUrl,
      imageUse: "source-preview-only",
      slot: config.slot,
      time: { prepMinutes: Math.min(25, Math.max(5, Math.round(config.totalMinutes * 0.3))), totalMinutes: config.totalMinutes },
      servings: config.servings,
      macros,
      sourceDeclaredNutrition: source.source.declaredNutrition,
      ingredients: config.ingredients,
      instructionFacts: steps.map((step, index) => ({ id: `source-fact-${index + 1}`, order: index + 1, actions: [step.action], action: step.action, text: "", ingredientIds: [] })),
      paraphrasedInstructionDraft: steps,
      proceduralStatus: "ready",
      proceduralBlockers: [],
      localization: { fit: "familiar", availability: "common", excludeSuggested: false, reviewNote: `Утверждённая владельцем домашняя адаптация. ${config.adaptation}` },
      editorialStatus: "promoted",
      storage: safeStorage(config),
      packing: { portion: `1/${config.servings} готовой партии`, label: `${config.titleRu} · дата готовки · хранение по карточке` },
      catalogSections: ["simple_home"],
      miseEditorialAdaptation: {
        kind: "simple_home_measured_adaptation_v1",
        reviewedAt: "2026-08-31",
        decisions: [
          source.sourceDecisionFile,
          "data/simple-home-review-resolutions-v2.json",
          "data/simple-home-runtime-approval.json",
        ],
        sourceFacts: "data/simple-home-source-extract.json",
        proteinRule: "at_least_25g_per_serving",
        proteinPerServing: macros.protein,
        note: config.adaptation,
      },
    };
  });
  const missing = [...approvedIds].filter((id) => !candidates.some((candidate) => candidate.id === id));
  if (missing.length) throw new Error(`Approved simple-home recipes are missing from the generator: ${missing.join(", ")}`);
  return {
    schemaVersion: 1,
    importedAt: approval.approvedAt,
    source: "Mise — Простые и домашние (owner-reviewed adaptations)",
    candidates,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : "data/simple-home-candidates.json";
  const document = await buildSimpleHomeCandidates();
  const absolute = resolve(output);
  const temporary = `${absolute}.tmp`;
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, absolute);
  process.stdout.write(`${JSON.stringify({ output: absolute, count: document.candidates.length })}\n`);
}
