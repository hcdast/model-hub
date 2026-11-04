import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsNumber, IsBoolean, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ArrayMaxSize } from 'class-validator';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ClientId } from '../auth/decorators/client-info.decorator';
import { DramaKind } from './drama.types';
import { ShortDramaService } from './drama.service';
import { ShortDramaRenderService } from './drama-render.service';

class CreateDramaDto { @IsOptional() @IsObject() plan?: Record<string, unknown> }
class UpdateDramaDto { @IsInt() @Min(0) revision!: number; @IsObject() plan!: Record<string, unknown> }
class QuoteDramaDto {
  @IsIn(['script', 'character', 'scene', 'image', 'video', 'voice', 'music']) kind!: DramaKind;
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(64, { each: true }) targetIds!: string[];
  @IsOptional() @IsString() @MaxLength(24) configId?: string;
  @IsOptional() @IsObject() parameters?: Record<string, unknown>;
}
class ConfirmDramaDto { @IsUUID() quoteId!: string }
class VoiceListDto {
  @IsString() @MaxLength(24) configId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1;
}
class AssetDramaDto {
  @IsIn(['character', 'scene', 'image', 'video', 'voice', 'music']) kind!: DramaKind;
  @IsString() @MaxLength(64) targetId!: string; @IsUUID() assetId!: string;
}
class RenderDramaDto { @IsInt() @Min(0) revision!: number; @IsUUID() requestId!: string }
class DramaListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @IsIn(['true', 'false']) archived?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
class BudgetDramaDto { @IsInt() @Min(0) revision!: number; @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1000000) limit!: number }
class ArchiveDramaDto { @IsInt() @Min(0) revision!: number; @IsBoolean() archived!: boolean }
class RestoreDramaDto { @IsInt() @Min(0) revision!: number; @IsInt() @Min(0) target!: number }
const envelope = (data: unknown) => ({ code: 0, message: 'Success', data });

@ApiTags('短剧制作')
@Controller('v1/short-dramas')
@UseGuards(ApiKeyOrJwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ShortDramaController {
  constructor(private readonly service: ShortDramaService, private readonly render: ShortDramaRenderService) {}
  @Get('capabilities') async capabilities() { return envelope({ ...await this.render.capabilities(), generationEnabled: process.env.DRAMA_GENERATION_ENABLED !== 'false', createEnabled: process.env.DRAMA_CREATE_ENABLED !== 'false', exportEnabled: process.env.DRAMA_EXPORT_ENABLED !== 'false' }); }
  @Get('models') async models() { return envelope(await this.service.catalog()); }
  @Get('voices') async voices(@ClientId() owner: string, @Query() dto: VoiceListDto) { return envelope(await this.service.voices(owner, dto.configId, dto.page)); }
  @Get('templates') async templates() { return envelope(await this.service.templates()); }
  @Post('templates/:templateId/create') async fromTemplate(@ClientId() owner: string, @Param('templateId') templateId: string) { return envelope(await this.service.fromTemplate(owner, templateId)); }
  @Get() async list(@ClientId() owner: string, @Query() query: DramaListDto) { return envelope(await this.service.list(owner, query.page, query.archived === 'true', query.search)); }
  @Post() async create(@ClientId() owner: string, @Body() dto: CreateDramaDto) { return envelope(await this.service.create(owner, dto.plan)); }
  @Get(':id') async get(@ClientId() owner: string, @Param('id') id: string) { return envelope(await this.service.get(owner, id)); }
  @Put(':id') async update(@ClientId() owner: string, @Param('id') id: string, @Body() dto: UpdateDramaDto) { return envelope(await this.service.update(owner, id, dto.revision, dto.plan)); }
  @Post(':id/quotes') async quote(@ClientId() owner: string, @Param('id') id: string, @Body() dto: QuoteDramaDto) { return envelope(await this.service.quote(owner, id, dto.kind, dto.targetIds, dto.configId, dto.parameters)); }
  @Post(':id/generate') async generate(@ClientId() owner: string, @Param('id') id: string, @Body() dto: ConfirmDramaDto) { return envelope(await this.service.confirm(owner, id, dto.quoteId)); }
  @Post(':id/assets') async attach(@ClientId() owner: string, @Param('id') id: string, @Body() dto: AssetDramaDto) { return envelope(await this.service.attach(owner, id, dto.kind, dto.targetId, dto.assetId)); }
  @Post(':id/candidates/:candidateId/cancel') async cancel(@ClientId() owner: string, @Param('id') id: string, @Param('candidateId') candidateId: string) { return envelope(await this.service.cancel(owner, id, candidateId)); }
  @Post(':id/exports') async export(@ClientId() owner: string, @Param('id') id: string, @Body() dto: RenderDramaDto) { return envelope(await this.render.start(owner, id, dto.revision, dto.requestId)); }
  @Put(':id/budget') async budget(@ClientId() owner: string, @Param('id') id: string, @Body() dto: BudgetDramaDto) { return envelope(await this.service.setBudget(owner, id, dto.revision, dto.limit)); }
  @Post(':id/copy') async copy(@ClientId() owner: string, @Param('id') id: string) { return envelope(await this.service.copy(owner, id)); }
  @Post(':id/archive-retry') async retryArchives(@ClientId() owner: string, @Param('id') id: string) { return envelope(await this.service.retryArchives(owner, id)); }
  @Put(':id/archive') async archive(@ClientId() owner: string, @Param('id') id: string, @Body() dto: ArchiveDramaDto) { return envelope(await this.service.archive(owner, id, dto.revision, dto.archived)); }
  @Post(':id/restore') async restore(@ClientId() owner: string, @Param('id') id: string, @Body() dto: RestoreDramaDto) { return envelope(await this.service.restore(owner, id, dto.revision, dto.target)); }
  @Get(':id/candidates/:candidateId/media') async media(@ClientId() owner: string, @Param('id') id: string, @Param('candidateId') candidateId: string, @Res() response: Response) {
    const media = await this.service.media(owner, id, candidateId);
    response.set({ 'Content-Type': media.type, 'Content-Length': String(media.data.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(media.data);
  }
}
