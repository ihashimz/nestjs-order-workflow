import { MigrationInterface, QueryRunner } from "typeorm";
export class Initial1770000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY, email text NOT NULL UNIQUE,
        password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('owner','admin'))
      );
      CREATE TABLE inventory (
        sku varchar(64) PRIMARY KEY, name varchar(160) NOT NULL,
        available integer NOT NULL CHECK (available >= 0)
      );
      CREATE TABLE orders (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
        idempotency_key varchar(128) NOT NULL, request_hash char(64) NOT NULL,
        items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
        state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','cancelled','expired')),
        expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_id,idempotency_key)
      );
      CREATE INDEX orders_owner_created ON orders(owner_id,created_at DESC,id);
      CREATE TABLE outbox (
        id uuid PRIMARY KEY, order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
        available_at timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz, attempts integer NOT NULL DEFAULT 0
      );
      CREATE INDEX outbox_pending ON outbox(available_at,next_attempt_at) WHERE processed_at IS NULL;
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE outbox; DROP TABLE orders; DROP TABLE inventory; DROP TABLE users;",
    );
  }
}
