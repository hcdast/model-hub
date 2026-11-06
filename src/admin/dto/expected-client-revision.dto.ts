import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExpectedClientRevisionDto {
  @ApiProperty({ description: '编辑时读取的客户端配置版本', minimum: 0 })
  @IsInt()
  @Min(0)
  expected_revision!: number;
}
