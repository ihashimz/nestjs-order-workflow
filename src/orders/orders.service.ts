import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import {
  Actor,
  Item,
  authorize,
  nextState,
  normalize,
  requestHash,
} from "./policy";
import { Order } from "../database/entities";
@Injectable()
export class OrdersService {
  constructor(private readonly db: DataSource) {}
  async create(actor: Actor, key: string, input: Item[]): Promise<Order> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key ?? ""))
      throw new BadRequestException(
        "Provide a 1–128 character Idempotency-Key",
      );
    const items = normalize(input),
      hash = requestHash(items);
    return this.db.transaction(async (tx) => {
      // Database advisory lock serializes even the first request, before a row exists.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${actor.id}/${key}`,
      ]);
      const [existing]: Order[] = await tx.query(
        "SELECT * FROM orders WHERE owner_id=$1 AND idempotency_key=$2",
        [actor.id, key],
      );
      if (existing) {
        if (existing.request_hash !== hash)
          throw new ConflictException(
            "Idempotency key reused with different items",
          );
        return existing;
      }
      const stock: { sku: string; available: number }[] = await tx.query(
        "SELECT sku, available FROM inventory WHERE sku = ANY($1::text[]) ORDER BY sku FOR UPDATE",
        [items.map((i) => i.sku)],
      );
      for (const item of items) {
        const product = stock.find((p) => p.sku === item.sku);
        if (!product || product.available < item.quantity)
          throw new ConflictException(`Insufficient inventory: ${item.sku}`);
      }
      for (const item of items)
        await tx.query(
          "UPDATE inventory SET available = available - $2 WHERE sku=$1",
          [item.sku, item.quantity],
        );
      const [{ now }]: { now: Date }[] = await tx.query(
        "SELECT clock_timestamp() AS now",
      );
      const id = randomUUID();
      const expires = new Date(new Date(now).getTime() + 15 * 60 * 1000);
      const [order]: Order[] = await tx.query(
        `INSERT INTO orders (id,owner_id,idempotency_key,request_hash,items,expires_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
        [id, actor.id, key, hash, JSON.stringify(items), expires],
      );
      await tx.query(
        "INSERT INTO outbox (id,order_id,available_at) VALUES ($1,$2,$3)",
        [randomUUID(), id, expires],
      );
      return order;
    });
  }
  async get(actor: Actor, id: string): Promise<Order> {
    const [order]: Order[] = await this.db.query(
      "SELECT * FROM orders WHERE id=$1 AND (owner_id=$2 OR $3::boolean)",
      [id, actor.id, actor.role === "admin"],
    );
    if (!order) throw new NotFoundException("Order not found");
    authorize(order.owner_id, actor);
    return order;
  }
  async list(actor: Actor, limit = 20, offset = 0): Promise<Order[]> {
    return this.db.query(
      "SELECT * FROM orders WHERE owner_id=$1 OR $2::boolean ORDER BY created_at DESC,id LIMIT $3 OFFSET $4",
      [actor.id, actor.role === "admin", limit, offset],
    );
  }
  async transition(
    actor: Actor | null,
    id: string,
    action: "confirmed" | "cancelled" | "expired",
  ): Promise<Order> {
    return this.db.transaction(async (tx) => {
      const [order]: Order[] = await tx.query(
        "SELECT * FROM orders WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!order) throw new NotFoundException("Order not found");
      if (actor) authorize(order.owner_id, actor);
      else if (action !== "expired")
        throw new BadRequestException("Worker may only expire");
      const [{ now }]: { now: Date }[] = await tx.query(
        "SELECT clock_timestamp() AS now",
      );
      const next = nextState(
        order.state,
        action,
        new Date(order.expires_at),
        new Date(now),
      );
      if (next.release) {
        const items = normalize(order.items);
        await tx.query(
          "SELECT sku, available FROM inventory WHERE sku = ANY($1::text[]) ORDER BY sku FOR UPDATE",
          [items.map((i) => i.sku)],
        );
        for (const item of items)
          await tx.query(
            "UPDATE inventory SET available = available + $2 WHERE sku=$1",
            [item.sku, item.quantity],
          );
      }
      if (next.state !== order.state) {
        const [updated]: Order[] = await tx.query(
          "UPDATE orders SET state=$2 WHERE id=$1 RETURNING *",
          [id, next.state],
        );
        Object.assign(order, updated);
      }
      // Confirmation/cancellation also closes expiry work; every terminal replay is harmless.
      await tx.query(
        "UPDATE outbox SET processed_at=now() WHERE order_id=$1 AND processed_at IS NULL",
        [id],
      );
      return order;
    });
  }
}
