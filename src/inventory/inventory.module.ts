import { Controller, Get, Module, Query, UseGuards } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthModule, JwtAuthGuard } from "../auth/auth.module";
import { PageDto } from "../orders/orders.dto";
@ApiTags("inventory")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("inventory")
class InventoryController {
  constructor(private readonly db: DataSource) {}
  @Get()
  list(@Query() page: PageDto) {
    return this.db.query(
      "SELECT sku,name,available FROM inventory ORDER BY sku LIMIT $1 OFFSET $2",
      [page.limit, page.offset],
    );
  }
}
@Module({ imports: [AuthModule], controllers: [InventoryController] })
export class InventoryModule {}
