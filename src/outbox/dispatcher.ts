import { DataSource } from "typeorm";
import { Queue } from "bullmq";
export class OutboxDispatcher {
  constructor(
    private readonly db: DataSource,
    private readonly queue: Queue,
  ) {}
  async dispatch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const events: { id: string; order_id: string }[] =
        await tx.query(`SELECT id,order_id FROM outbox
        WHERE processed_at IS NULL AND available_at<=now() AND next_attempt_at<=now()
        ORDER BY available_at LIMIT 50 FOR UPDATE SKIP LOCKED`);
      for (const event of events) {
        const jobId = `expiry-${event.id}`;
        const previous = await this.queue.getJob(jobId);
        // Keep the DB event until completion, including when Redis loses all jobs.
        if (previous && (await previous.getState()) === "failed")
          await previous.remove();
        await this.queue.add(
          "expire",
          { orderId: event.order_id },
          {
            jobId,
            attempts: 5,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: { age: 3600, count: 10000 },
            removeOnFail: false,
          },
        );
        await tx.query(
          "UPDATE outbox SET next_attempt_at=now()+interval '30 seconds', attempts=attempts+1 WHERE id=$1",
          [event.id],
        );
      }
      return events.length;
    });
  }
}
