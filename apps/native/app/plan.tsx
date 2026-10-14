import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { CHILD_ACTIVITY_FROM_AGE, calculateChildNutritionTarget, calculateNutritionTarget, childEstimateOf, childMacrosForCalories, macrosForCalories, personCalorieRange } from '@mise/domain/nutrition';
import { generateMobilePlan, PlanGenerationError } from '@mise/domain/plan-generator';
import { useApp } from '../src/app-state';
import { ALLERGEN_OPTIONS, CHILD_ACTIVITY_OPTIONS, DEFAULT_KITCHEN_EQUIPMENT, DISLIKE_OPTIONS, KITCHEN_EQUIPMENT, type KindUndo, personNormIssue, SLOT_LABELS, SLOTS, type SpicyDefault, switchToAdult, switchToChild, updateChildEstimate, validateDraft } from '../src/logic';
import type { ChildNutritionInput, Draft, Macros, MealSlot, NutritionWizardInput, Person, Plan } from '../src/types';
import { Body, Button, Card, Choice, Field, Label, Screen, Status, Title } from '../src/ui';

const stepTitles = ['На сколько дней?', 'Какие приёмы пищи?', 'Какое направление?', 'Для кого готовим?', 'Что исключить?', 'Когда готовим?', 'Проверьте план'];
const initialEstimate: NutritionWizardInput = { sex: 'male', age: 30, height: 175, weight: 75, activity: 'medium', musclePriority: false, goal: 'maintenance', monthlyWeightChangeKg: 1 };
const numbers: (keyof Macros)[] = ['kcal', 'protein', 'fat', 'carbs'];

export default function PlanWizard() {
  const { draft, updateDraft, bootstrap, savePlan, loading, error, refresh } = useApp();
  const [step, setStep] = useState(0);
  const [personIndex, setPersonIndex] = useState(0);
  const [preview, setPreview] = useState<Plan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allowDisliked, setAllowDisliked] = useState(false);
  const [canRelaxDislikes, setCanRelaxDislikes] = useState(false);
  // While the card is open: what switching to a child changed, and whether «Острое» was already defaulted.
  const kindUndo = useRef(new Map<string, KindUndo>());
  const spicyDefaults = useRef(new Map<string, SpicyDefault>());
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (step > 0) { setStep(step - 1); return true; } return false; }); return () => sub.remove(); }, [step]);
  const person = draft?.people[personIndex];
  const change = (next: Draft) => { setMessage(null); setPreview(null); void updateDraft(next); };
  const patchPerson = (patch: Partial<Person>) => {
    if (!draft || !person) return;
    change({ ...draft, people: draft.people.map((item, index) => index === personIndex ? { ...item, ...patch } : item) });
  };
  const generate = (includeDisliked: boolean) => {
    if (!draft || !bootstrap) return setMessage('Каталог пока недоступен.');
    try {
      const generated = generateMobilePlan(bootstrap.raw, { ...draft, id: Crypto.randomUUID(), createdAt: new Date().toISOString(), includeDisliked });
      setPreview({ ...generated, mealExecution: { eaten: [] } } as unknown as Plan);
      setAllowDisliked(includeDisliked); setCanRelaxDislikes(false); setMessage(null); setStep(6);
    } catch (cause) { setCanRelaxDislikes(cause instanceof PlanGenerationError && cause.code === 'no_candidate' && !includeDisliked); setMessage(cause instanceof Error ? cause.message : 'Не удалось собрать меню.'); }
  };
  const next = () => {
    if (!draft) return;
    if (step === 0 && (draft.periodDays < 1 || draft.periodDays > 14)) return setMessage('Период: от 1 до 14 дней.');
    if (step === 1 && !draft.mealSlots.length) return setMessage('Выберите хотя бы один приём пищи.');
    if (step === 3 && draft.people.some(item => !item.name.trim() || !item.includedSlots.length)) return setMessage('Укажите имя и приёмы пищи каждого человека.');
    const normIssue = step === 3 ? draft.people.map(personNormIssue).find(Boolean) : null;
    if (normIssue) return setMessage(normIssue);
    if (step === 5) {
      const invalid = validateDraft(draft);
      if (invalid) return setMessage(invalid);
      if (!bootstrap) return setMessage('Каталог пока не загружен. Подключитесь к сети и повторите.');
      return generate(allowDisliked);
    }
    setMessage(null); setStep(step + 1);
  };
  const save = async () => {
    if (!preview) return;
    setSaving(true); setMessage(null);
    try { await savePlan(preview); router.replace('/(tabs)'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Не удалось сохранить план.'); }
    finally { setSaving(false); }
  };
  const replace = (key: string) => {
    if (!preview || !draft || !bootstrap) return;
    const pinnedSelections = Object.fromEntries(Object.entries(preview.selections).filter(([itemKey]) => itemKey !== key));
    const pinnedAssignments = Object.fromEntries(Object.entries(preview.selectionAssignments ?? {}).filter(([itemKey]) => itemKey !== key));
    const excluded = (preview.selectionAssignments?.[key] ?? [{ recipeId: preview.selections[key] }]).map(item => item.recipeId);
    try {
      const changed = generateMobilePlan(bootstrap.raw, { ...draft, id: preview.id, createdAt: preview.createdAt, includeDisliked: allowDisliked,
        pinnedSelections, pinnedAssignments, excludedRecipeIds: { [key]: excluded } });
      setPreview({ ...changed, mealExecution: { eaten: [] } } as unknown as Plan); setMessage(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Не нашлось подходящей замены.'); }
  };
  if (loading || !draft) return <Screen><Status loading /></Screen>;
  const setNumber = (field: 'periodDays' | 'cookEveryDays', value: string) => change({ ...draft, [field]: Number(value.replace(/[^0-9]/g, '')) || 0 });
  const updateEstimate = (field: keyof NutritionWizardInput, value: unknown) => {
    if (!person) return;
    const estimate = { ...(person.estimate ?? initialEstimate), [field]: value } as NutritionWizardInput;
    const calculated = calculateNutritionTarget(estimate);
    patchPerson({ estimate, nutritionTargetMode: 'auto', ...('target' in calculated ? { daily: calculated.target } : {}) });
  };
  const switchKind = (next: 'adult' | 'child') => {
    if (!draft || !person || (person.kind === 'child') === (next === 'child')) return;
    if (next === 'child') {
      const { patch, undo } = switchToChild(person, draft.people);
      kindUndo.current.set(person.id, undo);
      spicyDefaults.current.delete(person.id);
      patchPerson(patch);
    } else {
      patchPerson(switchToAdult(person, kindUndo.current.get(person.id), spicyDefaults.current.get(person.id)?.added ?? false));
      kindUndo.current.delete(person.id);
      spicyDefaults.current.delete(person.id);
    }
  };
  const updateChild = (change: Partial<ChildNutritionInput>) => {
    if (!person) return;
    const { patch, spicy } = updateChildEstimate(person, change, spicyDefaults.current.get(person.id) ?? { applied: false, added: false });
    spicyDefaults.current.set(person.id, spicy);
    patchPerson(patch);
  };
  const child = person?.kind === 'child';
  const childAge = person?.childEstimate?.age;
  const childInput = child ? childEstimateOf(person?.childEstimate) : null;
  const childCalculation = childInput ? calculateChildNutritionTarget(childInput) : null;
  const childNorm = childCalculation && 'target' in childCalculation ? childCalculation.target : null;
  const calorieRange = person ? personCalorieRange(person) : null;
  const summary = preview ? Object.entries(preview.selections).map(([key, recipeId]) => {
    const [batchId, slot] = key.split(':');
    return { key, label: `Партия ${(preview.batches.find(batch => batch.id === batchId)?.index ?? 0) + 1} · ${SLOT_LABELS[slot as MealSlot] ?? slot}`,
      recipe: bootstrap?.recipes.find(recipe => recipe.id === recipeId), assignments: preview.selectionAssignments?.[key] };
  }) : [];
  return <Screen><Title subtitle={`Шаг ${step + 1} из ${stepTitles.length}`}>{stepTitles[step]}</Title>
    {step === 0 ? <Card><Body>План можно начать сегодня или выбрать дату. Покажем партии готовки на весь период.</Body>
      <Field label="Первый день (ГГГГ-ММ-ДД)" value={draft.start} onChangeText={start => change({ ...draft, start })} />
      <Field label="Дней в плане" value={String(draft.periodDays)} onChangeText={value => setNumber('periodDays', value)} keyboardType="numeric" />
      <Body muted>От 1 до 14 дней. Для первой недели удобно 3–7 дней.</Body></Card> : null}
    {step === 1 ? <Card><Body>Отметьте позиции, которые Mise подготовит.</Body>{SLOTS.map(slot => <Choice key={slot} title={SLOT_LABELS[slot]} selected={draft.mealSlots.includes(slot)} onPress={() => {
      const slots = draft.mealSlots.includes(slot) ? draft.mealSlots.filter(item => item !== slot) : SLOTS.filter(item => item === slot || draft.mealSlots.includes(item));
      change({ ...draft, mealSlots: slots, people: draft.people.map(item => ({ ...item, includedSlots: SLOTS.filter(part => slots.includes(part) && (item.includedSlots.includes(part) || part === slot && !draft.mealSlots.includes(slot))) })) });
    }} />)}</Card> : null}
    {step === 2 ? <Card><Choice title="Простые" selected={draft.menuStyle === 'simple'} onPress={() => change({ ...draft, menuStyle: 'simple' })} detail="Привычные блюда, обычные продукты и минимум действий" />
      <Choice title="Высокобелковое" selected={draft.menuStyle === 'protein'} onPress={() => change({ ...draft, menuStyle: 'protein' })} detail="Приоритет блюд с белковым профилем" />
      <Choice title="Бюджетное" selected={draft.menuStyle === 'budget'} onPress={() => change({ ...draft, menuStyle: 'budget' })} detail="Относительная оценка стоимости, без цен магазина" /></Card> : null}
    {step === 3 && person ? <><Card><Label>Люди в плане</Label>{draft.people.map((item, index) => <Choice key={item.id} title={item.name || `Человек ${index + 1}`} detail={personNormIssue(item) ? 'Норма не рассчитана' : `${item.kind === 'child' ? 'Ребёнок · ' : ''}${item.daily.kcal} ккал`} selected={index === personIndex} onPress={() => setPersonIndex(index)} />)}
      {draft.people.length < 4 ? <Button title="Добавить человека" secondary onPress={() => {
        const nextPerson: Person = { id: Crypto.randomUUID(), name: '', daily: macrosForCalories(2000, 'balanced'), includedSlots: [...draft.mealSlots], dislikes: [], hardExclusions: [], nutritionTargetMode: 'manual' };
        change({ ...draft, people: [...draft.people, nextPerson] }); setPersonIndex(draft.people.length);
      }} /> : null}
      {draft.people.length > 1 ? <Button title="Удалить этого человека" secondary onPress={() => { change({ ...draft, people: draft.people.filter(item => item.id !== person.id) }); setPersonIndex(0); }} /> : null}</Card>
      <Card><Label>Кто это</Label>
        <Choice title="Взрослый" selected={!child} onPress={() => switchKind('adult')} />
        <Choice title="Ребёнок 3–17 лет" selected={child} onPress={() => switchKind('child')} />
        <Field label={child ? 'Имя — для подписи контейнеров' : 'Имя'} value={person.name} onChangeText={name => patchPerson({ name })} />
        <Label>Приёмы пищи для этого человека</Label>{draft.mealSlots.map(slot => <Choice key={slot} title={SLOT_LABELS[slot]} selected={person.includedSlots.includes(slot)} onPress={() => patchPerson({ includedSlots: person.includedSlots.includes(slot) ? person.includedSlots.filter(item => item !== slot) : SLOTS.filter(item => item === slot || person.includedSlots.includes(item)).filter(item => draft.mealSlots.includes(item)) })} />)}
        {child ? <Body muted>Ест в саду или школе — снимите эти приёмы. Выходные Mise отдельно не планирует.</Body> : null}
        {child ? <>
          <Field label="Возраст, лет" value={childAge === undefined ? '' : String(childAge)} keyboardType="numeric" onChangeText={value => { const digits = value.replace(/[^0-9]/g, ''); updateChild({ age: digits ? Number(digits) : undefined }); }} />
          {childAge !== undefined && childAge > 0 && childAge < 3 ? <Body muted>Для детей до 3 лет Mise пока не считает порции: питание малыша лучше обсудить с педиатром.</Body> : null}
          <Label>Пол</Label>
          <Choice title="Мальчик" selected={person.childEstimate?.sex === 'male'} onPress={() => updateChild({ sex: 'male' })} />
          <Choice title="Девочка" selected={person.childEstimate?.sex === 'female'} onPress={() => updateChild({ sex: 'female' })} />
          {childAge !== undefined && childAge >= CHILD_ACTIVITY_FROM_AGE && childAge <= 17 ? <><Label>Подвижность</Label>{CHILD_ACTIVITY_OPTIONS.map(option => <Choice key={option.id} title={option.label} selected={(person.childEstimate?.activity ?? 'usual') === option.id} onPress={() => updateChild({ activity: option.id })} />)}</>
            : childAge !== undefined && childAge >= 3 && childAge < CHILD_ACTIVITY_FROM_AGE ? <Body muted>До 6 лет учитывается средняя подвижность для возраста.</Body> : null}
          <Label>Потребность в день</Label>
          <Choice title="По возрасту" selected={person.nutritionTargetMode !== 'manual'} onPress={() => patchPerson(childNorm ? { nutritionTargetMode: 'auto', daily: childNorm } : { nutritionTargetMode: 'auto' })} />
          <Choice title="Врач назначил свою норму" selected={person.nutritionTargetMode === 'manual'} onPress={() => patchPerson(childNorm ? { nutritionTargetMode: 'manual', daily: childNorm } : { nutritionTargetMode: 'manual' })} />
          {person.nutritionTargetMode === 'manual' ? <>
            <Field label="Калории в день — норма от врача или диетолога" value={String(person.daily.kcal)} keyboardType="numeric" onChangeText={value => patchPerson({ daily: childMacrosForCalories(Number(value.replace(/[^0-9]/g, '')) || 0) })} />
            <Body>Б {person.daily.protein} · Ж {person.daily.fat} · У {person.daily.carbs}</Body>
            {calorieRange ? <Body muted>Допустимый дневной диапазон для этого возраста — {calorieRange[0]}–{calorieRange[1]} ккал.</Body> : null}
            <Body muted>Норма введена вручную — например, по назначению врача или диетолога. Возрастную норму Mise не применяет.</Body>
          </> : childNorm ? <>
            <Body>Потребность: {person.daily.kcal} ккал · Б {person.daily.protein} · Ж {person.daily.fat} · У {person.daily.carbs}</Body>
            <Body muted>Средняя потребность детей этого возраста. У конкретного ребёнка она бывает на 15–20% больше или меньше — ориентируйтесь на аппетит: порцию можно не доесть или добавить. Если врач назначил особое питание, введите его цифры вручную.</Body>
          </> : <Body muted>Укажите возраст от 3 до 17 лет и пол — Mise посчитает потребность.</Body>}
          {person.nutritionTargetMode !== 'manual' && childNorm ? <Body muted>Ориентир по возрастным нормам ВОЗ/ФАО (2004), а не медицинская рекомендация. Детям Mise не урезает калории.</Body> : null}
          {childAge !== undefined && childAge > 0 && childAge <= 4 ? <Body muted>До 5 лет: орехи и семечки — только молотыми или рублеными, колбаски — вдоль тонкими полосками, виноград и черри — на четвертинки, сырую морковь и яблоко — тереть.</Body> : null}
        </> : <>
        <Label>Дневные КБЖУ</Label><Choice title="Ввести свои" selected={person.nutritionTargetMode === 'manual'} onPress={() => patchPerson({ nutritionTargetMode: 'manual', estimate: undefined })} />
        <Choice title="Помогите рассчитать" selected={person.nutritionTargetMode === 'auto'} onPress={() => updateEstimate('age', person.estimate?.age ?? initialEstimate.age)} />
        {person.nutritionTargetMode === 'manual' ? numbers.map(key => <Field key={key} label={{ kcal: 'Ккал', protein: 'Белки, г', fat: 'Жиры, г', carbs: 'Углеводы, г' }[key]} value={String(person.daily[key])} keyboardType="numeric" onChangeText={value => {
          const number = Number(value.replace(/[^0-9]/g, '')) || 0;
          patchPerson({ daily: key === 'kcal' ? macrosForCalories(number, 'balanced') : { ...person.daily, [key]: number, kcal: (key === 'protein' ? number : person.daily.protein) * 4 + (key === 'fat' ? number : person.daily.fat) * 9 + (key === 'carbs' ? number : person.daily.carbs) * 4 } });
        }} />) : <><Choice title="Мужчина" selected={(person.estimate ?? initialEstimate).sex === 'male'} onPress={() => updateEstimate('sex', 'male')} /><Choice title="Женщина" selected={(person.estimate ?? initialEstimate).sex === 'female'} onPress={() => updateEstimate('sex', 'female')} />
          {(['age', 'height', 'weight', 'monthlyWeightChangeKg'] as const).map(key => <Field key={key} label={{ age: 'Возраст', height: 'Рост, см', weight: 'Вес, кг', monthlyWeightChangeKg: 'Изменение веса, кг/мес' }[key]} value={String((person.estimate ?? initialEstimate)[key])} keyboardType="numeric" onChangeText={value => updateEstimate(key, Number(value.replace(',', '.')) || 0)} />)}
          {(['low', 'light', 'medium', 'high', 'athlete'] as const).map(key => <Choice key={key} title={{ low: 'Мало активности', light: 'Лёгкая', medium: 'Средняя', high: 'Высокая', athlete: 'Очень высокая' }[key]} selected={(person.estimate ?? initialEstimate).activity === key} onPress={() => updateEstimate('activity', key)} />)}
          {(['maintenance', 'loss', 'gain'] as const).map(key => <Choice key={key} title={{ maintenance: 'Поддерживать вес', loss: 'Снижать вес', gain: 'Набирать вес' }[key]} selected={(person.estimate ?? initialEstimate).goal === key} onPress={() => updateEstimate('goal', key)} />)}
          <Choice title="Приоритет сохранения мышц" selected={(person.estimate ?? initialEstimate).musclePriority} onPress={() => updateEstimate('musclePriority', !(person.estimate ?? initialEstimate).musclePriority)} />
          {personNormIssue(person) ? <Body muted>{personNormIssue(person)}</Body> : <Body>Ориентир: {person.daily.kcal} ккал · Б {person.daily.protein} · Ж {person.daily.fat} · У {person.daily.carbs}</Body>}</>}
        <Body muted>КБЖУ — ориентир, а не медицинская рекомендация. Для аллергий проверяйте состав конкретной упаковки.</Body></>}</Card></> : null}
    {step === 4 ? draft.people.map((item, index) => <Card key={item.id}><Label>{item.name || `Человек ${index + 1}`}</Label>
      <Body>Не люблю</Body>{DISLIKE_OPTIONS.map(option => <Choice key={option.id} title={option.label} selected={item.dislikes.includes(option.id)} onPress={() => {
        // A parent's own choice of «Острое» is final: Mise no longer sets or clears it by age.
        if (option.id === 'spicy') spicyDefaults.current.set(item.id, { applied: true, added: false });
        change({ ...draft, people: draft.people.map(person => person.id === item.id ? { ...person, dislikes: person.dislikes.includes(option.id) ? person.dislikes.filter(code => code !== option.id) : [...person.dislikes, option.id] } : person) });
      }} />)}
      <Body>Аллергия / мне нельзя</Body>{ALLERGEN_OPTIONS.map(option => <Choice key={option.id} title={option.label} selected={item.hardExclusions.includes(option.id)} onPress={() => change({ ...draft, people: draft.people.map(person => person.id === item.id ? { ...person, hardExclusions: person.hardExclusions.includes(option.id) ? person.hardExclusions.filter(code => code !== option.id) : [...person.hardExclusions, option.id] } : person) })} />)}
      <Body muted>Жёсткие исключения обязательны при подборе. Следы аллергенов в покупаемом продукте проверяйте по упаковке.</Body>
      {item.kind === 'child' ? <Body muted>Ребёнку заранее отмечены «Алкоголь», «Спортивный протеин» и до 12 лет «Острое». С ребёнком в плане общие блюда подбираются без отмеченного — снимите, если ему можно.</Body> : null}</Card>) : null}
    {step === 5 ? <Card><Body>Как часто удобно готовить? Для длинных партий часть порций может потребоваться заморозить.</Body>
      <Field label="Готовить каждые N дней" value={String(draft.cookEveryDays)} keyboardType="numeric" onChangeText={value => setNumber('cookEveryDays', value)} />
      <Body muted>От 1 до {draft.periodDays} дней. Если хранение блюда не покрывает партию и заморозка невозможна, оно не попадёт в меню.</Body>
      <Label>Что есть под рукой?</Label>
      <Body>Отметьте технику и посуду. Mise подберёт только блюда, которые можно приготовить на вашей кухне.</Body>
      {KITCHEN_EQUIPMENT.map(option => <Choice key={option.id} title={option.label} selected={draft.kitchenEquipment.includes(option.id)} onPress={() => change({ ...draft, kitchenEquipment: draft.kitchenEquipment.includes(option.id) ? draft.kitchenEquipment.filter(item => item !== option.id) : [...draft.kitchenEquipment, option.id] })} />)}
      <Button title="Обычная кухня" secondary onPress={() => change({ ...draft, kitchenEquipment: [...DEFAULT_KITCHEN_EQUIPMENT] })} />
      <Button title="Без техники" secondary onPress={() => change({ ...draft, kitchenEquipment: [] })} />
      <Body muted>Нож, доска и миска считаются базовыми. Отдельно выбирать «обычный рецепт» или «для мультиварки» не нужно.</Body></Card> : null}
    {step === 6 ? <><Card><Body>{draft.periodDays} дней · {draft.people.length} чел. · готовка каждые {draft.cookEveryDays} дн.</Body>
      <Body>{draft.kitchenEquipment.length ? KITCHEN_EQUIPMENT.filter(option => draft.kitchenEquipment.includes(option.id)).map(option => option.label).join(' · ') : 'Без техники'}</Body>
      <Body muted>Количество продуктов рассчитано из базовых порций каталога. Фактический выход готового блюда и точность КБЖУ могут отличаться.</Body></Card>
      {summary.map(item => <Card key={item.key}><Label>{item.label}</Label>
        {item.assignments && item.assignments.length > 1 ? item.assignments.map(assignment => <Body key={assignment.recipeId}>{bootstrap?.recipes.find(recipe => recipe.id === assignment.recipeId)?.title ?? assignment.recipeId} · {assignment.personIds.map(id => draft.people.find(person => person.id === id)?.name ?? id).join(', ')}</Body>) : <Body>{item.recipe?.title ?? item.key}</Body>}
        <Button title={item.assignments && item.assignments.length > 1 ? 'Заменить все блюда этого приёма' : 'Заменить блюдо'} secondary onPress={() => replace(item.key)} /></Card>)}
      <Button title={saving ? 'Сохраняем…' : 'Сохранить план'} onPress={() => void save()} disabled={saving || !preview} /></> : null}
    {message ? <Status error={message} /> : null}
    {step === 5 && canRelaxDislikes ? <Button title="Показать варианты с нелюбимыми продуктами" secondary onPress={() => generate(true)} /> : null}
    {error && !bootstrap ? <Status error={error} retry={refresh} /> : null}
    {step < 6 ? <Button title="Дальше" onPress={next} /> : null}
    <Button title={step === 0 ? 'Выйти' : 'Назад'} secondary onPress={() => step === 0 ? router.back() : setStep(step - 1)} />
  </Screen>;
}
