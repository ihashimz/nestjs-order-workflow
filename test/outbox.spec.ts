import { DataSource } from "typeorm";
import { Queue } from "bullmq";
import { OutboxDispatcher } from "../src/outbox/dispatcher";
test("publication keeps event pending until expiry transaction completes", async () => {
  const statements: string[] = [];
  const manager = {
    query: async (sql: string) => {
      statements.push(sql);
      return sql.startsWith("SELECT")
        ? [{ id: "event-id", order_id: "order-id" }]
        : [];
    },
  };
  const db = {
    transaction: async (fn: any) => fn(manager),
  } as unknown as DataSource;
  const add = jest.fn().mockResolvedValue({});
  expect(
    await new OutboxDispatcher(db, {
      add,
      getJob: async () => undefined,
    } as unknown as Queue).dispatch(),
  ).toBe(1);
  expect(add).toHaveBeenCalledWith(
    "expire",
    { orderId: "order-id" },
    expect.objectContaining({ jobId: "expiry-event-id", attempts: 5 }),
  );
  expect(statements.some((s) => s.includes("SKIP LOCKED"))).toBe(true);
  expect(statements.some((s) => s.includes("processed_at=now()"))).toBe(false);
});
test("queue errors roll back dispatch and surface for retry", async () => {
  const transaction = jest.fn(async (fn: any) =>
    fn({ query: async () => [{ id: "event", order_id: "order" }] }),
  );
  const db = { transaction } as unknown as DataSource;
  const queue = {
    getJob: async () => undefined,
    add: async () => {
      throw new Error("Redis unavailable");
    },
  } as unknown as Queue;
  await expect(new OutboxDispatcher(db, queue).dispatch()).rejects.toThrow(
    "Redis unavailable",
  );
});

test("exhausted queue jobs can be republished while durable event is pending", async () => {
  const db = {
    transaction: async (fn: any) =>
      fn({
        query: async (sql: string) =>
          sql.startsWith("SELECT") ? [{ id: "event", order_id: "order" }] : [],
      }),
  } as unknown as DataSource;
  const remove = jest.fn().mockResolvedValue(undefined),
    add = jest.fn().mockResolvedValue({});
  const queue = {
    getJob: async () => ({ getState: async () => "failed", remove }),
    add,
  } as unknown as Queue;
  await new OutboxDispatcher(db, queue).dispatch();
  expect(remove).toHaveBeenCalled();
  expect(add).toHaveBeenCalled();
});
