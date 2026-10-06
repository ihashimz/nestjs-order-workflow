import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
export type State = "pending" | "confirmed" | "cancelled" | "expired";
export type Actor = { id: string; role: "owner" | "admin" };
export type Item = { sku: string; quantity: number };
export function normalize(items: Item[]): Item[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50)
    throw new BadRequestException("Provide 1–50 items");
  const seen = new Set<string>();
  for (const item of items) {
    if (
      !/^[A-Z0-9_-]{1,64}$/.test(item.sku) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 1000 ||
      seen.has(item.sku)
    )
      throw new BadRequestException("Invalid or duplicate item");
    seen.add(item.sku);
  }
  return items
    .map(({ sku, quantity }) => ({ sku, quantity }))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
}
export function requestHash(items: Item[]): string {
  return createHash("sha256")
    .update(JSON.stringify(normalize(items)))
    .digest("hex");
}
export function authorize(ownerId: string, actor: Actor): void {
  if (ownerId !== actor.id && actor.role !== "admin")
    throw new NotFoundException("Order not found");
}
export function nextState(
  current: State,
  action: Exclude<State, "pending">,
  expires: Date,
  now: Date,
): { state: State; release: boolean } {
  if (current === action || (action === "expired" && current !== "pending"))
    return { state: current, release: false };
  if (current !== "pending") throw new ConflictException("Order is terminal");
  if (action === "confirmed" && now >= expires)
    throw new ConflictException("Reservation deadline passed");
  if (action === "expired" && now < expires)
    throw new ConflictException("Reservation is not due");
  return { state: action, release: action !== "confirmed" };
}
