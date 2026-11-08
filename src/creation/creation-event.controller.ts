import { Body, Controller, HttpException, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ClientId } from '../auth/decorators/client-info.decorator';
import { CreationEventService } from './creation-event.service';
class PublicEventDto {
  @IsIn(['template_view', 'create_click']) name!: string;
  @IsIn(['workflow', 'short-drama']) kind!: 'workflow' | 'short-drama';
  @IsString() @MaxLength(64) templateId!: string;
  @IsUUID() sessionId!: string;
}
class PrivateEventDto {
  @IsIn(['quote_viewed', 'take_selected', 'download_started']) name!: string;
  @IsUUID() projectId!: string;
  @IsString() @MaxLength(64) referenceId!: string;
}
@Controller('v1/creation-events')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class CreationEventController {
  private readonly buckets = new Map<string, { until: number; count: number }>();
  constructor(private readonly service: CreationEventService) {}
  @Post('public') publicEvent(@Body() dto: PublicEventDto, @Req() req: Request) {
    const now = Date.now(), key = createHash('sha256').update(req.ip || 'unknown').digest('hex');
    if (this.buckets.size >= 10000) for (const [id, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(id);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.until <= now) { if (this.buckets.size >= 10000 && !bucket) throw new HttpException('稍后重试', 429); bucket = { until: now + 60000, count: 0 }; this.buckets.set(key, bucket); }
    if (++bucket.count > 120) throw new HttpException('稍后重试', 429);
    return this.service.publicEvent(dto);
  }
  @Post() @UseGuards(ApiKeyOrJwtGuard) privateEvent(@ClientId() owner: string, @Body() dto: PrivateEventDto) { return this.service.privateEvent(owner, dto); }
}
