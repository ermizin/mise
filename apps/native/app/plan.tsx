import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { calculateNutritionTarget, macrosForCalories } from '@mise/domain/nutrition';
import { generateMobilePlan, PlanGenerationError } from '@mise/domain/plan-generator';
import { useApp } from '../src/app-state';
import { ALLERGEN_OPTIONS, DEFAULT_KITCHEN_EQUIPMENT, DISLIKE_OPTIONS, KITCHEN_EQUIPMENT, SLOT_LABELS, SLOTS, validateDraft } from '../src/logic';
import type { Draft, Macros, MealSlot, NutritionWizardInput, Person, Plan } from '../src/types';
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
    {step === 3 && person ? <><Card><Label>Люди в плане</Label>{draft.people.map((item, index) => <Choice key={item.id} title={item.name || `Человек ${index + 1}`} selected={index === personIndex} onPress={() => setPersonIndex(index)} />)}
      {draft.people.length < 4 ? <Button title="Добавить человека" secondary onPress={() => {
        const nextPerson: Person = { id: Crypto.randomUUID(), name: '', daily: macrosForCalories(2000, 'balanced'), includedSlots: [...draft.mealSlots], dislikes: [], hardExclusions: [], nutritionTargetMode: 'manual' };
        change({ ...draft, people: [...draft.people, nextPerson] }); setPersonIndex(draft.people.length);
      }} /> : null}
      {draft.people.length > 1 ? <Button title="Удалить этого человека" secondary onPress={() => { change({ ...draft, people: draft.people.filter(item => item.id !== person.id) }); setPersonIndex(0); }} /> : null}</Card>
      <Card><Field label="Имя" value={person.name} onChangeText={name => patchPerson({ name })} />
        <Label>Приёмы пищи для этого человека</Label>{draft.mealSlots.map(slot => <Choice key={slot} title={SLOT_LABELS[slot]} selected={person.includedSlots.includes(slot)} onPress={() => patchPerson({ includedSlots: person.includedSlots.includes(slot) ? person.includedSlots.filter(item => item !== slot) : SLOTS.filter(item => item === slot || person.includedSlots.includes(item)).filter(item => draft.mealSlots.includes(item)) })} />)}
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
          <Body>Ориентир: {person.daily.kcal} ккал · Б {person.daily.protein} · Ж {person.daily.fat} · У {person.daily.carbs}</Body></>}
        <Body muted>КБЖУ — ориентир, а не медицинская рекомендация. Для аллергий проверяйте состав конкретной упаковки.</Body></Card></> : null}
    {step === 4 ? draft.people.map((item, index) => <Card key={item.id}><Label>{item.name || `Человек ${index + 1}`}</Label>
      <Body>Не люблю</Body>{DISLIKE_OPTIONS.map(option => <Choice key={option.id} title={option.label} selected={item.dislikes.includes(option.id)} onPress={() => change({ ...draft, people: draft.people.map(person => person.id === item.id ? { ...person, dislikes: person.dislikes.includes(option.id) ? person.dislikes.filter(code => code !== option.id) : [...person.dislikes, option.id] } : person) })} />)}
      <Body>Аллергия / мне нельзя</Body>{ALLERGEN_OPTIONS.map(option => <Choice key={option.id} title={option.label} selected={item.hardExclusions.includes(option.id)} onPress={() => change({ ...draft, people: draft.people.map(person => person.id === item.id ? { ...person, hardExclusions: person.hardExclusions.includes(option.id) ? person.hardExclusions.filter(code => code !== option.id) : [...person.hardExclusions, option.id] } : person) })} />)}
      <Body muted>Жёсткие исключения обязательны при подборе. Следы аллергенов в покупаемом продукте проверяйте по упаковке.</Body></Card>) : null}
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
