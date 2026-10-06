import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { OrdersService } from "../src/orders/orders.service";
import { Initial1770000000000 } from "../src/database/migrations/1770000000000-Initial";
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("PostgreSQL transaction integration (dedicated test database)", () => {
  let db: DataSource, service: OrdersService;
  const actor = { id: randomUUID(), role: "owner" as const };
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    const admin = new DataSource({
      type: "postgres",
      url: process.env.TEST_DATABASE_URL,
    });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.destroy();
    db = new DataSource({
      type: "postgres",
      url: process.env.TEST_DATABASE_URL,
      extra: { options: `-c search_path=${schema}`, max: 10 },
    });
    await db.initialize();
    const runner = db.createQueryRunner();
    try {
      await new Initial1770000000000().up(runner);
    } finally {
      await runner.release();
    }
    service = new OrdersService(db);
  });
  beforeEach(async () => {
    await db.query("TRUNCATE outbox,orders,inventory,users CASCADE");
    await db.query(
      "INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)",
      [actor.id, "test@example.test", "unused", "owner"],
    );
    await db.query(
      "INSERT INTO inventory VALUES ('A','Synthetic item',2),('B','Second item',2)",
    );
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      await db.destroy();
    }
  });
  test("parallel creation cannot oversell actual locked rows", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        service.create(actor, `key-${i}`, [{ sku: "A", quantity: 2 }]),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db.query("SELECT available FROM inventory WHERE sku='A'"))[0]
        .available,
    ).toBe(0);
    expect(
      (await db.query("SELECT count(*)::int AS total FROM outbox"))[0].total,
    ).toBe(1);
  });
  test("parallel identical keys reserve once and changed input conflicts", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.create(actor, "same", [{ sku: "A", quantity: 1 }]),
      ),
    );
    expect(new Set(results.map((o) => o.id)).size).toBe(1);
    expect(
      (await db.query("SELECT available FROM inventory WHERE sku='A'"))[0]
        .available,
    ).toBe(1);
    await expect(
      service.create(actor, "same", [{ sku: "A", quantity: 2 }]),
    ).rejects.toThrow();
  });
  test("failed multi-line reservation rolls back all inventory", async () => {
    await expect(
      service.create(actor, "bad", [
        { sku: "A", quantity: 1 },
        { sku: "B", quantity: 3 },
      ]),
    ).rejects.toThrow();
    expect(
      await db.query("SELECT available FROM inventory ORDER BY sku"),
    ).toEqual([{ available: 2 }, { available: 2 }]);
    expect(
      (await db.query("SELECT count(*)::int AS total FROM orders"))[0].total,
    ).toBe(0);
  });
  test("confirmation versus cancellation yields one terminal outcome", async () => {
    const order = await service.create(actor, "race", [
      { sku: "A", quantity: 2 },
    ]);
    const results = await Promise.allSettled([
      service.transition(actor, order.id, "confirmed"),
      service.transition(actor, order.id, "cancelled"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const final = await service.get(actor, order.id);
    expect(
      (await db.query("SELECT available FROM inventory WHERE sku='A'"))[0]
        .available,
    ).toBe(final.state === "cancelled" ? 2 : 0);
  });
  test("expiry retries and cancellation race release once", async () => {
    const order = await service.create(actor, "expire", [
      { sku: "A", quantity: 2 },
    ]);
    await db.query(
      "UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=$1",
      [order.id],
    );
    await Promise.allSettled([
      service.transition(null, order.id, "expired"),
      service.transition(actor, order.id, "cancelled"),
      service.transition(null, order.id, "expired"),
    ]);
    expect(
      (await db.query("SELECT available FROM inventory WHERE sku='A'"))[0]
        .available,
    ).toBe(2);
    expect(
      (await db.query("SELECT processed_at FROM outbox"))[0].processed_at,
    ).not.toBeNull();
  });
  test("database owner scope rejects foreign reads", async () => {
    const order = await service.create(actor, "private", [
      { sku: "A", quantity: 1 },
    ]);
    await expect(
      service.get({ id: randomUUID(), role: "owner" }, order.id),
    ).rejects.toThrow();
  });
});
