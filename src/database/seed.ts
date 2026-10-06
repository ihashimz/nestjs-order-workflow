import { randomUUID } from "node:crypto";
import dataSource from "./data-source";
import { hashPassword } from "../auth/password";
import { required } from "../common/config";
async function seed() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Development seed is disabled in production");
  await dataSource.initialize();
  try {
    for (const role of ["admin", "owner"] as const) {
      const prefix = `SEED_${role.toUpperCase()}`;
      const email = required(`${prefix}_EMAIL`).toLowerCase(),
        password = required(`${prefix}_PASSWORD`);
      if (password.length < 12 || password.length > 128)
        throw new Error("Seed password must have 12–128 characters");
      const hash = await hashPassword(password);
      await dataSource.query(
        `INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)
        ON CONFLICT(email) DO NOTHING`,
        [randomUUID(), email, hash, role],
      );
    }
    await dataSource.query(`INSERT INTO inventory(sku,name,available) VALUES
      ('SYNTHETIC-MUG','Synthetic ceramic mug',30),('SYNTHETIC-NOTEBOOK','Synthetic notebook',20)
      ON CONFLICT(sku) DO NOTHING`);
  } finally {
    await dataSource.destroy();
  }
}
void seed().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
