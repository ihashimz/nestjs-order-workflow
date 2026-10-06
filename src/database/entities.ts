import { Column, Entity, PrimaryColumn } from "typeorm";
import { Item, State } from "../orders/policy";
@Entity("users")
export class User {
  @PrimaryColumn("uuid")
  id!: string;
  @Column("text")
  email!: string;
  @Column("text")
  password_hash!: string;
  @Column("text")
  role!: "owner" | "admin";
}
@Entity("inventory")
export class Inventory {
  @PrimaryColumn({ type: "varchar", length: 64 })
  sku!: string;
  @Column({ type: "varchar", length: 160 })
  name!: string;
  @Column("integer")
  available!: number;
}
@Entity("orders")
export class Order {
  @PrimaryColumn("uuid")
  id!: string;
  @Column("uuid")
  owner_id!: string;
  @Column({ type: "varchar", length: 128 })
  idempotency_key!: string;
  @Column({ type: "char", length: 64 })
  request_hash!: string;
  @Column("jsonb")
  items!: Item[];
  @Column("text")
  state!: State;
  @Column("timestamptz")
  expires_at!: Date;
  @Column("timestamptz")
  created_at!: Date;
}
@Entity("outbox")
export class Outbox {
  @PrimaryColumn("uuid")
  id!: string;
  @Column("uuid")
  order_id!: string;
  @Column("timestamptz")
  available_at!: Date;
  @Column("timestamptz")
  next_attempt_at!: Date;
  @Column({ type: "timestamptz", nullable: true })
  processed_at!: Date | null;
  @Column("integer")
  attempts!: number;
}
