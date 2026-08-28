export function pluralRu(count: number, one: string, few: string, many: string) {
  const absolute = Math.abs(count) % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function countRu(count: number, one: string, few: string, many: string) {
  return `${count} ${pluralRu(count, one, few, many)}`;
}
