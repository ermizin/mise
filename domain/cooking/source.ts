import { makeCookingSignature } from "../cooking-session";
import type { CookingSessionInput } from "./types";

/** Content identity is shared by browser and server; it includes confirmed resources and recipe quantities. */
export async function cookingSourceSignature(input: CookingSessionInput): Promise<string> {
  const bytes = new TextEncoder().encode(makeCookingSignature(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
