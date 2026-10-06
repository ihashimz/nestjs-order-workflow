import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthModule, AuthRequest, JwtAuthGuard } from "../auth/auth.module";
import { CreateOrderDto, PageDto } from "./orders.dto";
import { OrdersService } from "./orders.service";
@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders")
class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Reserve stock for 15 minutes" })
  create(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.orders.create(req.user, key, dto.items);
  }
  @Get()
  list(@Req() req: AuthRequest, @Query() page: PageDto) {
    return this.orders.list(req.user, page.limit, page.offset);
  }
  @Get(":id")
  get(@Req() req: AuthRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.get(req.user, id);
  }
  @Post(":id/confirm")
  confirm(@Req() req: AuthRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.transition(req.user, id, "confirmed");
  }
  @Post(":id/cancel")
  cancel(@Req() req: AuthRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.transition(req.user, id, "cancelled");
  }
}
@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
