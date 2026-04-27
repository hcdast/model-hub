import { PartialType } from '@nestjs/swagger';
import { CreateModelConfigDto } from './create-model-config.dto';

/**
 * 更新模型配置 DTO
 * 所有字段都是可选的
 */
export class UpdateModelConfigDto extends PartialType(CreateModelConfigDto) {}
