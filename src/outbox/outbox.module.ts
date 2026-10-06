import {
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { Worker } from "bullmq";
import { ExpiryQueue } from "../common/infrastructure.module";
import { redisOptions } from "../common/config";
import { OrdersService } from "../orders/orders.service";
import { OutboxDispatcher } from "./dispatcher";
@Injectable()
class ExpiryRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ExpiryRuntime.name);
  private timer?: NodeJS.Timeout;
  private worker?: Worker;
  private active?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly db: DataSource,
    private readonly queue: ExpiryQueue,
    private readonly orders: OrdersService,
  ) {}
  onModuleInit() {
    const dispatch = new OutboxDispatcher(this.db, this.queue);
    this.worker = new Worker(
      "order-expiry",
      async (job) => {
        if (job.name !== "expire" || typeof job.data.orderId !== "string")
          throw new Error("Invalid expiry job");
        await this.orders.transition(null, job.data.orderId, "expired");
        this.log.log({
          event: "expiry_completed",
          jobId: job.id,
          orderId: job.data.orderId,
        });
      },
      {
        connection: {
          ...redisOptions(),
          connectTimeout: 5000,
          maxRetriesPerRequest: null,
        },
        concurrency: 4,
      },
    );
    this.worker.on("failed", (job, error) =>
      this.log.error({
        event: "expiry_failed",
        jobId: job?.id,
        attempt: job?.attemptsMade,
        error: error.message,
      }),
    );
    this.worker.on("error", (error) =>
      this.log.error({ event: "worker_error", error: error.message }),
    );
    const tick = () => {
      if (this.stopped || this.active) return;
      this.active = (async () => {
        try {
          const count = await dispatch.dispatch();
          if (count) this.log.log({ event: "outbox_published", count });
        } catch (error) {
          this.log.error({
            event: "outbox_dispatch_failed",
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      })().finally(() => {
        this.active = undefined;
      });
    };
    this.timer = setInterval(tick, 2000);
    tick();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
    await this.worker?.close();
  }
}
@Module({ providers: [OrdersService, ExpiryRuntime] })
export class OutboxModule {}
