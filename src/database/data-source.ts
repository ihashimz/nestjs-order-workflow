import "reflect-metadata";
import { DataSource } from "typeorm";
import { User, Inventory, Order, Outbox } from "./entities";
import { Initial1770000000000 } from "./migrations/1770000000000-Initial";
import { required } from "../common/config";
export const dbOptions = () => ({
  type: "postgres" as const,
  url: required("DATABASE_URL"),
  entities: [User, Inventory, Order, Outbox],
  migrations: [Initial1770000000000],
  synchronize: false,
  extra: { max: 10, connectionTimeoutMillis: 5000 },
  logging: false,
});
export default new DataSource(dbOptions());
