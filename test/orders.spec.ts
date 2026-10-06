import { DataSource } from "typeorm";
import { OrdersService } from "../src/orders/orders.service";

// Small SQL boundary double: transactions serialize to model row-lock exclusion.
// The optional PostgreSQL suite verifies actual locks and rollback semantics.
class Database {
  stock = 2;
  now = new Date();
  orders: any[] = [];
  events: any[] = [];
  statements: string[] = [];
  private tail = Promise.resolve();
  async transaction<T>(fn: (manager: any) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    const before = {
      stock: this.stock,
      orders: structuredClone(this.orders),
      events: structuredClone(this.events),
    };
    try {
      return await fn(this);
    } catch (error) {
      Object.assign(this, before);
      throw error;
    } finally {
      unlock();
    }
  }
  async query(sql: string, args: any[] = []): Promise<any[]> {
    this.statements.push(sql);
    if (sql.includes("SELECT clock_timestamp()")) return [{ now: this.now }];
    if (sql.includes("pg_advisory")) return [];
    if (sql.includes("FROM orders WHERE owner_id"))
      return this.orders.filter(
        (o) => o.owner_id === args[0] && o.idempotency_key === args[1],
      );
    if (sql.includes("FROM orders WHERE id"))
      return this.orders.filter((o) => o.id === args[0]);
    if (sql.startsWith("SELECT") && sql.includes("FROM inventory"))
      return [{ sku: "A", available: this.stock }];
    if (sql.includes("UPDATE inventory SET available = available -")) {
      this.stock -= args[1];
      return [];
    }
    if (sql.includes("UPDATE inventory SET available = available +")) {
      this.stock += args[1];
      return [];
    }
    if (sql.includes("INSERT INTO orders")) {
      const order = {
        id: args[0],
        owner_id: args[1],
        idempotency_key: args[2],
        request_hash: args[3],
        items: JSON.parse(args[4]),
        state: "pending",
        expires_at: args[5],
      };
      this.orders.push(order);
      return [order];
    }
    if (sql.includes("INSERT INTO outbox")) {
      this.events.push(args);
      return [];
    }
    if (sql.includes("UPDATE orders SET state")) {
      const order = this.orders.find((o) => o.id === args[0]);
      order.state = args[1];
      return [order];
    }
    if (sql.includes("UPDATE outbox")) return [];
    throw new Error(`Unsupported SQL: ${sql}`);
  }
}
const actor = { id: "owner-1", role: "owner" as const };
const items = [{ sku: "A", quantity: 2 }];
describe("transactional order service", () => {
  test("concurrent requests cannot oversell; one transaction rolls back", async () => {
    const db = new Database(),
      service = new OrdersService(db as unknown as DataSource);
    const results = await Promise.allSettled([
      service.create(actor, "one", items),
      service.create(actor, "two", items),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.stock).toBe(0);
    expect(db.orders).toHaveLength(1);
    expect(db.events).toHaveLength(1);
    expect(
      db.statements.some((sql) => sql.includes("ORDER BY sku FOR UPDATE")),
    ).toBe(true);
  });
  test("same key replays without reserving twice; changed payload conflicts", async () => {
    const db = new Database(),
      service = new OrdersService(db as unknown as DataSource);
    const original = await service.create(actor, "key", items);
    expect((await service.create(actor, "key", items)).id).toBe(original.id);
    expect(db.stock).toBe(0);
    expect(db.orders).toHaveLength(1);
    await expect(
      service.create(actor, "key", [{ sku: "A", quantity: 1 }]),
    ).rejects.toThrow();
  });
  test("cancel twice returns inventory once", async () => {
    const db = new Database(),
      service = new OrdersService(db as unknown as DataSource);
    const order = await service.create(actor, "key", items);
    expect(db.stock).toBe(0);
    await service.transition(actor, order.id, "cancelled");
    await service.transition(actor, order.id, "cancelled");
    expect(db.stock).toBe(2);
  });
  test("owner authorization blocks foreign reads and mutations", async () => {
    const db = new Database(),
      service = new OrdersService(db as unknown as DataSource);
    const order = await service.create(actor, "key", items);
    const foreign = { id: "other", role: "owner" as const };
    await expect(service.get(foreign, order.id)).rejects.toThrow();
    await expect(
      service.transition(foreign, order.id, "cancelled"),
    ).rejects.toThrow();
    expect(db.stock).toBe(0);
  });
  test("deadline checks use the database clock across API replicas", async () => {
    const db = new Database();
    const service = new OrdersService(db as unknown as DataSource);
    const order = await service.create(actor, "clock", items);
    db.now = new Date(new Date(order.expires_at).getTime() + 1);
    await expect(
      service.transition(actor, order.id, "confirmed"),
    ).rejects.toThrow("deadline");
    expect(db.stock).toBe(0);
  });
});
