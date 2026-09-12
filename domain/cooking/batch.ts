import type { CookingOperation, QuantityAllocation } from "./types";

function allocationKey(item: QuantityAllocation) {
  return [item.canonicalId, item.unit, item.state, item.cut ?? "", item.allergenGroup ?? ""].join("|");
}
function mergeKey(operation: CookingOperation) {
  return JSON.stringify({
    allocations: [...new Set(operation.allocations.map(allocationKey))].sort(),
    resources: operation.resources.map(item => item.resourceId).sort(),
    dependencies: [...operation.dependsOn].sort(),
  });
}
/** A merged prep retains every recipe-addressed allocation and rewires all dependants. */
export function mergeCompatiblePreparations(operations: readonly CookingOperation[]): CookingOperation[] {
  const result: CookingOperation[] = [];
  const groups = new Map<string, CookingOperation>();
  const aliases = new Map<string, string>();
  for (const operation of operations) {
    // Raw meat and held equipment have their own cleaning lifecycle; keep those boundaries explicit.
    if (operation.kind !== "prep" || operation.rawMeat || operation.resourceHolds?.length || !operation.allocations.length ||
        operation.allocations.some(item => !item.cut)) {
      result.push({ ...operation }); continue;
    }
    const key = mergeKey(operation);
    const existing = groups.get(key);
    if (!existing) {
      const copy = { ...operation, allocations: [...operation.allocations], sourceOperationIds: [operation.id] };
      groups.set(key, copy); result.push(copy); continue;
    }
    aliases.set(operation.id, existing.id);
    existing.sourceOperationIds!.push(operation.id);
    existing.allocations.push(...operation.allocations);
    existing.durationSeconds += operation.durationSeconds;
    existing.estimatedActive = true;
    existing.title = "Подготовьте продукты для нескольких блюд";
    existing.sourceText = `${existing.sourceText ?? ""}\n\n${operation.sourceText ?? ""}`;
  }
  return result.map(operation => ({ ...operation,
    dependsOn: [...new Set(operation.dependsOn.map(id => aliases.get(id) ?? id))],
    resourceHolds: operation.resourceHolds?.map(hold => ({ ...hold, releaseAfterOpId: aliases.get(hold.releaseAfterOpId) ?? hold.releaseAfterOpId })),
  }));
}
export const compatiblePreparationGroup = mergeCompatiblePreparations;
