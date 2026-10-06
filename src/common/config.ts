export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
export function jwtSecret(): string {
  const value = required("JWT_SECRET");
  if (value.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  return value;
}
export function redisOptions() {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(process.env.REDIS_PASSWORD
      ? { password: process.env.REDIS_PASSWORD }
      : {}),
  };
}
