import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA, MODULE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerStorageService } from "@nestjs/throttler";
import { AuthModule } from "../src/auth/auth.module";
const [controller] = Reflect.getMetadata(
  MODULE_METADATA.CONTROLLERS,
  AuthModule,
);
test("only login binds the standard throttle guard", () => {
  const guards =
    Reflect.getMetadata(GUARDS_METADATA, controller.prototype.login) ?? [];
  expect(guards).toContain(ThrottlerGuard);
  const me =
    Reflect.getMetadata(GUARDS_METADATA, controller.prototype.me) ?? [];
  expect(me).not.toContain(ThrottlerGuard);
});
test("login guard rejects the sixth attempt from the same client with 429", async () => {
  const storage = new ThrottlerStorageService();
  const guard = new ThrottlerGuard(
    [{ ttl: 60_000, limit: 5 }],
    storage,
    new Reflector(),
  );
  const context = {
    getHandler: () => controller.prototype.login,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ ip: "192.0.2.10", headers: {} }),
      getResponse: () => ({ header: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
  try {
    await guard.onModuleInit();
    for (let i = 0; i < 5; i++)
      expect(await guard.canActivate(context)).toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
  } finally {
    storage.onApplicationShutdown();
  }
});
