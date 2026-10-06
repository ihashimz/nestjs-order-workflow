import { INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { Request, Response, NextFunction, json } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
export function configure(app: INestApplication) {
  app.enableShutdownHooks();
  app.use(helmet());
  app.use(json({ limit: "32kb" }));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const log = new Logger("HTTP");
  app.use((req: Request, res: Response, next: NextFunction) => {
    const input = req.header("x-request-id");
    const requestId =
      input && /^[a-zA-Z0-9_-]{1,64}$/.test(input) ? input : randomUUID();
    res.setHeader("x-request-id", requestId);
    const start = Date.now();
    res.on("finish", () =>
      log.log({
        event: "http_request",
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    );
    next();
  });
}
