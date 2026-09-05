"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./icon";
export function Stepper({ value, min = 0, max = 12, label, onChange, disabled = false }: {
  value: number; min?: number; max?: number; label: string; onChange: (value: number) => void; disabled?: boolean;
}) {
  const current = useRef(value);
  const callback = useRef(onChange);
  useEffect(() => { current.current = value; callback.current = onChange; }, [value, onChange]);
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const repeated = useRef(false);
  function stop() { if (delay.current) clearTimeout(delay.current); if (repeat.current) clearInterval(repeat.current); }
  useEffect(() => stop, []);
  function change(delta: number) {
    const next = Math.min(max, Math.max(min, current.current + delta));
    if (next === current.current) return;
    current.current = next; callback.current(next);
  }
  return <div className="kitchen-stepper" role="group" aria-label={label}>
    {[-1, 1].map((delta) => <button key={delta} type="button"
      aria-label={`${delta < 0 ? "Уменьшить" : "Увеличить"}: ${label}`}
      disabled={disabled || (delta < 0 ? value <= min : value >= max)}
      onPointerDown={(event) => { if (event.button !== 0) return; stop(); repeated.current = false; event.currentTarget.setPointerCapture(event.pointerId); delay.current = setTimeout(() => { repeated.current = true; change(delta); repeat.current = setInterval(() => change(delta), 120); }, 400); }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop}
      onClick={() => { if (!repeated.current) change(delta); repeated.current = false; }}>
      <Icon name={delta < 0 ? "minus" : "plus"} size={16} />
    </button>)}
    <span role="status" aria-live="polite" aria-atomic="true" aria-label={`${label}: ${value}`}>{value}</span>
  </div>;
}
