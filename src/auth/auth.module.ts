import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { AuthGuard, PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { DataSource } from "typeorm";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { jwtSecret } from "../common/config";
import { User } from "../database/entities";
import { Actor } from "../orders/policy";
import { verifyPassword } from "./password";
export type AuthRequest = Request & { user: Actor };
export class LoginDto {
  @ApiProperty({ example: "owner@example.test" })
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly db: DataSource) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret(),
      ignoreExpiration: false,
      algorithms: ["HS256"],
      issuer: "order-workflow",
      audience: "order-workflow-api",
    });
  }
  async validate(payload: { sub?: string }): Promise<Actor> {
    if (!payload.sub || !/^[0-9a-f-]{36}$/i.test(payload.sub))
      throw new UnauthorizedException();
    const [user]: User[] = await this.db.query(
      "SELECT id,role FROM users WHERE id=$1",
      [payload.sub],
    );
    if (!user) throw new UnauthorizedException();
    return { id: user.id, role: user.role };
  }
}
@Injectable()
export class AuthService {
  constructor(
    private readonly db: DataSource,
    private readonly jwt: JwtService,
  ) {}
  async login(input: LoginDto) {
    const [user]: User[] = await this.db.query(
      "SELECT * FROM users WHERE email=$1",
      [input.email.toLowerCase()],
    );
    // Derive even for unknown users to avoid an obvious cheap email timing oracle.
    const dummy = "0".repeat(32) + ":" + "0".repeat(128);
    const valid = await verifyPassword(
      input.password,
      user?.password_hash ?? dummy,
    );
    if (!user || !valid) throw new UnauthorizedException("Invalid credentials");
    return {
      access_token: await this.jwt.signAsync({ sub: user.id }),
      token_type: "Bearer",
      expires_in: 900,
    };
  }
}
@ApiTags("auth")
@Controller("auth")
class AuthController {
  constructor(private readonly service: AuthService) {}
  @Post("login")
  @UseGuards(ThrottlerGuard)
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }
  @Get("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthRequest) {
    return req.user;
  }
}
@Module({
  imports: [
    PassportModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: jwtSecret(),
        signOptions: {
          expiresIn: 900,
          algorithm: "HS256",
          issuer: "order-workflow",
          audience: "order-workflow-api",
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, ThrottlerGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
