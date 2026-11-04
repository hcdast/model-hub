import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from 'class-validator';

export class DeleteModelConfigDto {
  @IsInt() @Min(0)
  expected_revision!: number;
}

export class DeleteModelConfigItemDto extends DeleteModelConfigDto {
  @IsMongoId()
  id!: string;
}

export class BulkDeleteModelConfigDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => DeleteModelConfigItemDto)
  items!: DeleteModelConfigItemDto[];
}
