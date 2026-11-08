import { Controller, Get, NotFoundException, Optional, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DRAMA_TEMPLATES, templatePlan } from './drama-templates';
import { CreationTemplateService } from '../creation/creation-template.service';
import { emptyTemplateMetrics, recommendationScore, TemplateInsightsService } from '../creation/template-insights.service';

class DramaTemplateQuery {
  @IsOptional() @IsString() @MaxLength(100) search = '';
  @IsOptional() @IsIn(['recommended', 'newest']) order: 'recommended' | 'newest' = 'recommended';
  @IsOptional() @IsIn(['official', 'community']) source?: 'official' | 'community';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) pageSize = 12;
}

/** Public descriptions contain only the curated story structure, never account/model configuration. */
@ApiTags('公开短剧模板目录')
@Controller('v1/catalog/drama-templates')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DramaTemplateCatalogController {
  constructor(private readonly templates: CreationTemplateService, @Optional() private readonly insights?: TemplateInsightsService) {}
  private available() {
    return process.env.DRAMA_TEMPLATES_ENABLED !== 'false' && process.env.DRAMA_CREATE_ENABLED !== 'false';
  }

  @Get()
  async list(@Query() query: DramaTemplateQuery) {
    if (!this.available()) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    const search = query.search.trim().toLocaleLowerCase();
    const official = DRAMA_TEMPLATES.filter(t =>
      `${t.name} ${t.description} ${t.character} ${t.shots.join(' ')}`.toLocaleLowerCase().includes(search),
    ).map(t => ({ ...this.entry(t.id), createdAt: '' }));
    const [community, stats] = await Promise.all([this.templates.publishedDramaSummaries(search), this.insights?.metrics('short-drama')]);
    const entries = [...official, ...community.map(t => ({ id: String(t._id), name: t.name as string, description: t.description as string,
      version: 1, kind: 'short-drama' as const, source: 'community' as const, shotCount: t.shotCount as number, generatedMedia: false as const, ratio: t.ratio as string, createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : '' }))]
      .filter(t => !query.source || t.source === query.source)
      .map(t => ({ ...t, metrics: stats?.metrics.get(t.id) || emptyTemplateMetrics() }));
    entries.sort((a, b) => (query.order === 'recommended' ? recommendationScore(b.metrics) - recommendationScore(a.metrics) : 0)
      || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    const skip = (query.page - 1) * query.pageSize;
    return { items: entries.slice(skip, skip + query.pageSize), total: entries.length, page: query.page, pageSize: query.pageSize, computedAt: stats ? new Date(stats.at).toISOString() : undefined };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    if (!this.available()) throw new NotFoundException('短剧模板暂未开放');
    const community = await this.templates.publishedDrama(id);
    const plan = community?.dramaPlan || templatePlan(id);
    if (!plan) throw new NotFoundException('短剧模板不存在或已下架');
    const entry = community ? { id, version: 1, name: community.name, description: community.description, kind: 'short-drama', source: 'community', shotCount: plan.shots.length, generatedMedia: false, ratio: plan.frame?.ratio || '9:16' } : this.entry(id);
    return { ...entry, instructions: community?.instructions || '', story: plan.story, characters: plan.characters.map(c => ({ name: c.name, description: c.description })),
      shots: plan.shots.map(s => ({ title: s.title, description: s.description, narration: s.narration, duration: s.duration })) };
  }

  private entry(id: string) {
    const t = DRAMA_TEMPLATES.find(t => t.id === id)!;
    return { id: t.id, version: t.version, name: t.name, description: t.description, kind: 'short-drama' as const,
      source: 'official' as const, shotCount: t.shots.length, generatedMedia: false, ratio: '9:16' };
  }
}
