export type DishAssemblyMode = "mixed" | "components";

export type CookedComponent = {
  componentId: string;
  label: string;
  cookedWeightG: number;
};

export type PersonAllocation = {
  personId: string;
  label: string;
  portionCount: number;
  nutritionShare: number;
  componentShares?: Record<string, number>;
};

export type ContainerAllocation = {
  personId: string;
  label: string;
  totalG: number;
  perContainerG: number[];
};

export type ComponentAllocation = CookedComponent & {
  allocations: ContainerAllocation[];
  allocatedWeightG: number;
  unallocatedWeightG: number;
};

export type MixedDishAllocation = {
  mode: "mixed";
  cookedWeightG: number;
  allocations: ContainerAllocation[];
  allocatedWeightG: number;
  unallocatedWeightG: number;
};

export type ComponentDishAllocation = {
  mode: "components";
  components: ComponentAllocation[];
};

function assertPeople(people: PersonAllocation[]) {
  if (!people.length) throw new Error("At least one person is required.");
  if (new Set(people.map(({ personId }) => personId)).size !== people.length)
    throw new Error("Person ids must be unique.");
  for (const person of people) {
    if (!Number.isInteger(person.portionCount) || person.portionCount < 1)
      throw new Error("Portion count must be a positive integer.");
    if (!Number.isFinite(person.nutritionShare) || person.nutritionShare < 0)
      throw new Error("Nutrition share must be a non-negative number.");
  }
}

function splitContainers(totalG: number, count: number) {
  const base = Math.floor(totalG / count);
  const remainder = totalG - base * count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function allocateWeight(
  cookedWeightG: number,
  people: PersonAllocation[],
  shareFor: (person: PersonAllocation) => number,
): {
  allocations: ContainerAllocation[];
  allocatedWeightG: number;
  unallocatedWeightG: number;
} {
  const available = Math.max(0, Math.floor(cookedWeightG));
  if (!Number.isFinite(cookedWeightG) || cookedWeightG < 0)
    throw new Error("Cooked weight must be a non-negative number.");
  assertPeople(people);
  const weights = people.map((person) => Math.max(0, shareFor(person)));
  const totalShare = weights.reduce((sum, value) => sum + value, 0);
  if (totalShare <= 0)
    throw new Error("At least one allocation share must be positive.");

  const exact = weights.map((weight) => (available * weight) / totalShare);
  const totals = exact.map(Math.floor);
  let remainder = available - totals.reduce((sum, value) => sum + value, 0);
  for (const index of exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .map(({ index }) => index)) {
    if (remainder <= 0) break;
    totals[index] += 1;
    remainder -= 1;
  }

  const allocations = people.map((person, index) => ({
    personId: person.personId,
    label: person.label,
    totalG: totals[index],
    perContainerG: splitContainers(totals[index], person.portionCount),
  }));
  const allocatedWeightG = allocations.reduce(
    (sum, allocation) => sum + allocation.totalG,
    0,
  );
  return {
    allocations,
    allocatedWeightG,
    unallocatedWeightG: available - allocatedWeightG,
  };
}

export function allocateMixedDish(
  cookedWeightG: number,
  people: PersonAllocation[],
): MixedDishAllocation {
  return {
    mode: "mixed",
    cookedWeightG: Math.max(0, Math.floor(cookedWeightG)),
    ...allocateWeight(cookedWeightG, people, (person) => person.nutritionShare),
  };
}

export function allocateComponentDish(
  components: CookedComponent[],
  people: PersonAllocation[],
): ComponentDishAllocation {
  if (!components.length)
    throw new Error("At least one cooked component is required.");
  if (
    new Set(components.map(({ componentId }) => componentId)).size !==
    components.length
  )
    throw new Error("Component ids must be unique.");
  return {
    mode: "components",
    components: components.map((component) => ({
      ...component,
      ...allocateWeight(
        component.cookedWeightG,
        people,
        (person) =>
          person.componentShares?.[component.componentId] ??
          person.nutritionShare,
      ),
    })),
  };
}
