export type CookingAction = {
  text: string;
  sourceStart: number;
  sourceEnd: number;
};

// This deliberately small vocabulary only recognises an explicit imperative.
// It is a splitter for reviewable source fragments, not a parser of cooking
// technique: anything uncertain remains in the surrounding action verbatim.
const imperative = String.raw`(?:нарежьте|измельчите|натрите|смешайте|соедините|взбейте|влейте|добавьте|вмешайте|выложите|распределите|переложите|разложите|смажьте|обжарьте|подрумяньте|готовьте|запекайте|запеките|выпекайте|тушите|томите|варите|сварите|отварите|приготовьте|разогрейте|разогревайте|нагрейте|доведите|накройте|снимите|дайте|оставьте|отложите|верните|переверните|промойте|очистите|слейте|откиньте|прогрейте|подайте|подавайте|посыпьте|полейте|охладите|остудите|заморозьте|замораживайте|разморозьте|упакуйте|разведите|сформуйте|поставьте|достаньте|покройте|вылейте|залейте|всыпьте|вымойте|взвесьте|замаринуйте|сложите|подсушите|держите|храните|собирайте|соберите|отмерьте|разровняйте|разрежьте|пробейте|вымесите|разберите|разомните)`;
const imperativeEnd = String.raw`(?=\s|$|[,:;.!?])`;
const boundaryBeforeImperative = new RegExp(String.raw`[.;!?](?=\s*(?:(?:затем|после этого)\s+)?${imperative}${imperativeEnd})|[.;!?](?=\s*(?:(?![.;!?]).){1,120}?\s${imperative}${imperativeEnd})|,(?=\s*(?:(?:затем|после этого)\s+)?${imperative}${imperativeEnd})|\s+(?=и\s+${imperative}${imperativeEnd})`, "giu");
const conditionalScope = /(?:если|либо|или|по желанию|при необходимости)/iu;
const imperativeFinder = new RegExp(imperative, "iu");
const imperativeMatcher = new RegExp(imperative, "giu");

function hasSubstantiveComplement(fragment: string): boolean {
  const matches = [...fragment.matchAll(imperativeMatcher)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return false;
  return /(?:\d|[A-Za-zА-Яа-яЁё]{2,})/u.test(fragment.slice(last.index + last[0].length));
}

/**
 * Splits only at a punctuation or conjunction boundary immediately before a
 * recognised Russian imperative. Joining returned `text` values reconstructs
 * the input byte-for-byte; conditions, alternatives, ranges, and participles
 * such as «помешивая» are never interpreted or rewritten.
 */
export function splitCookingActions(text: string): CookingAction[] {
  if (!text) return [];
  const starts = [0];
  for (const match of text.matchAll(boundaryBeforeImperative)) {
    const start = match.index! + match[0].length;
    const sentenceStart = Math.max(text.lastIndexOf(".", match.index), text.lastIndexOf("!", match.index), text.lastIndexOf("?", match.index)) + 1;
    // Action spans cannot carry a condition forward, so retain the entire
    // conditional or alternative sentence as one source-backed action.
    const beforeNextImperative = text.slice(start, start + 160).split(imperativeFinder, 1)[0];
    if (
      conditionalScope.test(text.slice(sentenceStart, match.index)) ||
      conditionalScope.test(beforeNextImperative)
    ) continue;
    if (!/[.!?]/u.test(match[0])) {
      const nextClause = text.slice(start).split(/[.;!?]/u, 1)[0];
      if (!hasSubstantiveComplement(text.slice(starts.at(-1), match.index)) || !hasSubstantiveComplement(nextClause)) continue;
    }
    if (start > starts[starts.length - 1] && start < text.length) starts.push(start);
  }
  return starts.map((sourceStart, index) => {
    const sourceEnd = starts[index + 1] ?? text.length;
    return { text: text.slice(sourceStart, sourceEnd), sourceStart, sourceEnd };
  });
}

/** A display-only label; offsets and `text` always retain the raw source. */
export function formatCookingActionText(text: string): string {
  const trimmed = text.trim();
  const linked = trimmed.replace(/^(?:и|затем)\s+/iu, "");
  const punctuated = linked.replace(/[,:;]+$/u, ".");
  return punctuated ? punctuated[0].toLocaleUpperCase("ru-RU") + punctuated.slice(1) : punctuated;
}
