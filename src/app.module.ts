import { Module } from "@nestjs/common";
import { InfrastructureModule } from "./common/infrastructure.module";
import { AuthModule } from "./auth/auth.module";
import { OrdersModule } from "./orders/orders.module";
import { InventoryModule } from "./inventory/inventory.module";
import { HealthModule } from "./health/health.module";
@Module({
  imports: [
    InfrastructureModule,
    AuthModule,
    OrdersModule,
    InventoryModule,
    HealthModule,
  ],
})
export class AppModule {}
