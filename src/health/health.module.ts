import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { ExpiryQueue } from "../common/infrastructure.module";
@Controller()
class HealthController {
  constructor(
    private readonly db: DataSource,
    private readonly queue: ExpiryQueue,
  ) {}
  @Get("health")
  live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    try {
      await Promise.all([
        this.db.query("SELECT 1 FROM inventory LIMIT 0"),
        this.queue.getJobCounts("waiting"),
      ]);
      return { status: "ready", dependencies: ["postgres", "redis"] };
    } catch {
      throw new ServiceUnavailableException("Dependencies unavailable");
    }
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
