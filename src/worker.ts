import { ConsoleLogger } from "@nestjs/common";
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { InfrastructureModule } from "./common/infrastructure.module";
import { OutboxModule } from "./outbox/outbox.module";
import { HealthModule } from "./health/health.module";
import { configure } from "./common/bootstrap";
@Module({ imports: [InfrastructureModule, OutboxModule, HealthModule] })
class WorkerModule {}
async function bootstrap() {
  const app = await NestFactory.create(WorkerModule, {
    logger: new ConsoleLogger({ json: true }),
    bodyParser: false,
  });
  configure(app);
  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}
void bootstrap();
