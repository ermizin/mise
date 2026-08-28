"use client";

import { useNumericInput } from "@/hooks/use-numeric-input";

export function MacroNumberInput({
  id,
  ariaLabel,
  value,
  onValueChange,
}: {
  id?: string;
  ariaLabel: string;
  value: number;
  onValueChange: (value: number) => void;
}) {
  const edit = useNumericInput(value, onValueChange);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={edit.text}
      onChange={(event) => edit.onChange(event.target.value)}
      onBlur={edit.onBlur}
    />
  );
}
