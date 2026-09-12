export type CookingInstruction = {
  id: string;
  text: string;
  action?: string;
  dependsOn?: string[];
  ingredientIds?: string[];
  duration?: string;
  equipment?: string[];
  donenessCue?: string;
};

function cloneInstruction<T extends CookingInstruction>(step: T): T {
  return {
    ...step,
    dependsOn: [...(step.dependsOn ?? [])],
    ingredientIds: step.ingredientIds ? [...step.ingredientIds] : undefined,
    equipment: step.equipment ? [...step.equipment] : undefined,
  };
}

/**
 * Return every executable instruction once, in dependency-safe order.
 *
 * Batch cooking deliberately stays conservative here: when two preparations
 * cannot be proven equivalent from structured data, keeping both is safer than
 * shortening the plan and silently dropping an action or quantity.
 */
export function orderedCookingInstructions<T extends CookingInstruction>(
  source: readonly T[],
): T[] {
  const steps = source
    .filter((step) => step.action !== "measure")
    .map(cloneInstruction);
  const ids = new Set(steps.map((step) => step.id));
  const remaining = [...steps];
  const emitted = new Set<string>();
  const result: T[] = [];

  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex((step) =>
      (step.dependsOn ?? []).every(
        (dependency) => !ids.has(dependency) || emitted.has(dependency),
      ),
    );
    if (readyIndex < 0) {
      // Malformed/cyclic metadata must never make an instruction disappear.
      result.push(...remaining);
      break;
    }
    const [next] = remaining.splice(readyIndex, 1);
    result.push(next);
    emitted.add(next.id);
  }

  return result;
}
