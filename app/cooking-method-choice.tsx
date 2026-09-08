import { useId } from "react";

import "./cooking-method-choice.css";

export type CookingMethodChoiceMethod = {
  id: string;
  label: string;
  requiredEquipment: string[];
  timeMinutes?: number;
  activeMinutes?: number;
  note?: string;
};

type CookingMethodChoiceProps = {
  methods: CookingMethodChoiceMethod[];
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (id: string) => void;
};

const equipmentNames: Record<string, string> = {
  stove: "плита",
  pot: "кастрюля",
  pan: "сковорода",
  oven: "духовка",
  baking_dish: "форма или противень",
  multicooker: "мультиварка",
  air_fryer: "аэрогриль",
  blender: "блендер / измельчитель",
  microwave: "микроволновка",
  waffle_iron: "вафельница",
  pressure_cooker: "скороварка",
};

function methodName(method: CookingMethodChoiceMethod) {
  if (method.id === "original") return "По рецепту";
  if (method.id === "multicooker") return "В мультиварке";
  if (method.id === "air_fryer") return "В аэрогриле";
  return method.label;
}

function methodContext(method: CookingMethodChoiceMethod) {
  if (method.id === "original") return "Готовьте так, как указано в рецепте.";
  if (method.id === "multicooker") return "Адаптированный способ для мультиварки.";
  if (method.id === "air_fryer") return "Адаптированный способ для аэрогриля.";
  return "Отдельный способ приготовления.";
}

function equipmentSummary(requiredEquipment: string[]) {
  if (!requiredEquipment.length) return "Без специальной техники";
  return `Понадобится: ${requiredEquipment.map((item) => equipmentNames[item] ?? item).join(" · ")}`;
}

function timingSummary(method: CookingMethodChoiceMethod) {
  const timings = [];
  if (Number.isFinite(method.timeMinutes)) timings.push(`всего ${method.timeMinutes} мин`);
  if (Number.isFinite(method.activeMinutes)) timings.push(`активно ${method.activeMinutes} мин`);
  return timings.join(" · ");
}

export function CookingMethodChoice({ methods, value, label, disabled = false, onChange }: CookingMethodChoiceProps) {
  const groupId = useId();
  const hintId = `${groupId}-hint`;

  return (
    <fieldset className="cooking-method-choice" disabled={disabled} aria-describedby={hintId}>
      <legend>{label}</legend>
      <p className="cooking-method-choice__hint" id={hintId}>
        Выберите, как вам удобнее готовить.
      </p>
      <div className="cooking-method-choice__options">
        {methods.map((method) => {
          const selected = method.id === value;
          const timing = timingSummary(method);
          const detailId = `${groupId}-${method.id}-detail`;
          return (
            <label className={`cooking-method-choice__option${selected ? " is-selected" : ""}`} key={method.id}>
              <input
                type="radio"
                name={groupId}
                value={method.id}
                checked={selected}
                onChange={() => onChange(method.id)}
                aria-describedby={detailId}
              />
              <span className="cooking-method-choice__radio" aria-hidden="true" />
              <span className="cooking-method-choice__content" id={detailId}>
                <span className="cooking-method-choice__title">{methodName(method)}</span>
                <span className="cooking-method-choice__context">{methodContext(method)}</span>
                {method.note && <span className="cooking-method-choice__note">{method.note}</span>}
                <span className="cooking-method-choice__equipment">{equipmentSummary(method.requiredEquipment)}</span>
                {timing && <span className="cooking-method-choice__timing">{timing}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
