import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class OrderItemDto {
  @ApiProperty({ example: "SYNTHETIC-MUG" })
  @Matches(/^[A-Z0-9_-]{1,64}$/)
  sku!: string;
  @ApiProperty({ minimum: 1, maximum: 1000, example: 2 })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;
}
export class CreateOrderDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
export class PageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  offset = 0;
}
