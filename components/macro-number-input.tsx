"use client";

import { useNumericInput } from "@/hooks/use-numeric-input";

export function MacroNumberInput({
  id,
  ariaLabel,
  describedBy,
  invalid = false,
  value,
  onValueChange,
}: {
  id?: string;
  ariaLabel: string;
  describedBy?: string;
  invalid?: boolean;
  value: number;
  onValueChange: (value: number) => void;
}) {
  const edit = useNumericInput(value, onValueChange);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      value={edit.text}
      onChange={(event) => edit.onChange(event.target.value)}
      onBlur={edit.onBlur}
    />
  );
}
