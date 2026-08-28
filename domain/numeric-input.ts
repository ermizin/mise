export type NumericEditState = {
  text: string;
  value: number | null;
};

export function normalizeIntegerEdit(raw: string): NumericEditState {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { text: "", value: null };
  const text = digits.replace(/^0+(?=\d)/, "");
  return { text, value: Number(text) };
}

export function formatIntegerValue(value: number) {
  if (!Number.isFinite(value)) return "";
  return String(Math.max(0, Math.trunc(value)));
}
