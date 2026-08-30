import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class IdentityDto {
  @IsString() channel!: string;
  @IsOptional() @IsInt() ownerId?: number;
  @IsOptional() @IsBoolean() managed?: boolean;
}

export class ReserveDto extends IdentityDto {
  @IsInt() @Min(1) quantity!: number;
}

export class ConfirmDto {
  @IsString() bookingRef!: string;
}
