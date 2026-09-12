import type { CookingEvent, CookingExecutionState } from "../domain/cooking/types";

/** The event log and execution revision are committed by the same CAS write. */
export function cookingMutationReplay(execution: CookingExecutionState, event: CookingEvent): "new" | "accepted" | "conflict" {
  const previous = execution.events.find(item => item.id === event.id);
  if (!previous) return "new";
  return previous.type === event.type && previous.opId === event.opId && previous.occurredAt === event.occurredAt && previous.endsAt === event.endsAt
    ? "accepted" : "conflict";
}
