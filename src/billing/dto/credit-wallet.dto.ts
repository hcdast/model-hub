import { IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 钱包充值 DTO
 *
 * 用于管理后台手动为指定 API Client 的钱包充值。
 */
export class CreditWalletDto {
  @ApiProperty({ description: '本次充值的唯一操作编号；超时重试必须复用同一编号', format: 'uuid' })
  @IsUUID('4')
  operationId!: string;

  @ApiProperty({ description: '充值金额（必须大于 0）', example: 100 })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ description: '充值原因', example: '手动充值' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
