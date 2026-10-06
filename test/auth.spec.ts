import { hashPassword, verifyPassword } from "../src/auth/password";
import { jwtSecret } from "../src/common/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateOrderDto } from "../src/orders/orders.dto";
test("password hashes are salted and wrong passwords fail", async () => {
  const one = await hashPassword("synthetic-password-123"),
    two = await hashPassword("synthetic-password-123");
  expect(one).not.toEqual(two);
  expect(one).not.toContain("synthetic-password");
  expect(await verifyPassword("synthetic-password-123", one)).toBe(true);
  expect(await verifyPassword("wrong-password", one)).toBe(false);
});
test("short JWT signing secrets fail closed", () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "short";
  try {
    expect(() => jwtSecret()).toThrow();
  } finally {
    if (previous) process.env.JWT_SECRET = previous;
    else delete process.env.JWT_SECRET;
  }
});
test("unknown client fields cannot grant roles or bypass quantity validation", async () => {
  const dto = plainToInstance(CreateOrderDto, {
    items: [{ sku: "A", quantity: -1 }],
    role: "admin",
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  expect(errors.some((e) => e.property === "role")).toBe(true);
  expect(errors.some((e) => e.property === "items")).toBe(true);
});
test("password derivation rejects unbounded inputs at the service boundary", async () => {
  await expect(hashPassword("x".repeat(129))).rejects.toThrow();
  await expect(hashPassword("short")).rejects.toThrow();
});
