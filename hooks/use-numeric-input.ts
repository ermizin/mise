"use client";

import { useState } from "react";
import {
  formatIntegerValue,
  normalizeIntegerEdit,
} from "@/domain/numeric-input";

export function useNumericInput(
  value: number,
  onValueChange: (value: number) => void,
) {
  const [editText, setEditText] = useState<string | null>(null);
  const text = editText ?? formatIntegerValue(value);

  function onChange(raw: string) {
    const next = normalizeIntegerEdit(raw);
    setEditText(next.text);
    if (next.value !== null) onValueChange(next.value);
  }

  function onBlur() {
    setEditText(null);
  }

  return { text, onChange, onBlur };
}
