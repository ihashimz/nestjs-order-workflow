import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { redisOptions } from "./config";
import { dbOptions } from "../database/data-source";
@Injectable()
export class ExpiryQueue extends Queue implements OnModuleDestroy {
  private readonly log = new Logger(ExpiryQueue.name);
  constructor() {
    super("order-expiry", {
      connection: {
        ...redisOptions(),
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      },
    });
    this.on("error", (error) =>
      this.log.error({ event: "queue_error", error: error.message }),
    );
  }
  async onModuleDestroy() {
    await this.close();
  }
}
@Global()
@Module({
  imports: [TypeOrmModule.forRootAsync({ useFactory: dbOptions })],
  providers: [ExpiryQueue],
  exports: [TypeOrmModule, ExpiryQueue],
})
export class InfrastructureModule {}
