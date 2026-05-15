import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { ProviderRegistry } from '../provider/provider.registry';
import { resolveConfigModelTypeForLookup } from '../common/utils/model-config-type.util';
import { ProviderRoutingService, RoutingRuleSimulationResult } from './provider-routing.service';

export interface RoutingPreviewInput {
  model: string;
  apiKey: string;
  /** 与创建任务 options.featureType 一致；不传则按 model 路径推断 */
  featureType?: string;
  options?: Record<string, unknown>;
  at?: Date;
}

export interface RoutingPreviewResult {
  at: string;
  model: string;
  apiKey: string;
  inferredFeatureType: string;
  configModelTypeUsed: string | null;
  modelConfig: {
    model_id: string;
    model_type?: string;
    provider?: string;
    disabled?: boolean;
    provider_model_name?: string;
  } | null;
  warnings: string[];
  ruleSimulation: RoutingRuleSimulationResult;
  resolution: {
    provider: string | null;
    routeId?: string;
    routingSource: 'routing_rule' | 'model_config_provider' | 'model_path' | 'unresolved';
    routingMetrics?: RoutingRuleHitRoutingMetrics;
    fallbackDetail: Record<string, unknown>;
    adapterRegistered: boolean;
  };
}

type RoutingRuleHitRoutingMetrics = {
  selectedLatencyMs?: number;
  selectedCostPerUnit?: number;
  candidates?: { provider: string; latencyMs?: number; costPerUnit?: number }[];
};

@Injectable()
export class RoutingPreviewService {
  constructor(
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
    private readonly providerRouting: ProviderRoutingService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async preview(input: RoutingPreviewInput): Promise<RoutingPreviewResult> {
    const at = input.at ?? new Date();
    const model = input.model.trim();
    const apiKey = input.apiKey.trim();
    const warnings: string[] = [];

    const rawFeatureOption = input.featureType?.trim() ? input.featureType.trim() : undefined;
    const inferredFeatureType = rawFeatureOption
      ? this.normalizeFeatureTypeOption(rawFeatureOption)
      : this.resolveTaskFeatureType(model, input.options);
    const configModelTypeUsed = resolveConfigModelTypeForLookup(inferredFeatureType, rawFeatureOption);

    const cfg = await this.modelConfigModel
      .findOne({
        model_id: model,
        ...(configModelTypeUsed != null ? { model_type: configModelTypeUsed } : {}),
      })
      .lean();

    if (cfg?.disabled) {
      warnings.push('该模型在 model_configs 中已禁用，实际创建任务将返回错误');
    }

    const ruleSimulation = await this.providerRouting.simulateFromRules(model, apiKey, at);

    let provider: string | null = null;
    let routeId: string | undefined;
    let routingSource: RoutingPreviewResult['resolution']['routingSource'] = 'unresolved';
    let routingMetrics: RoutingRuleHitRoutingMetrics | undefined;
    const fallbackDetail: Record<string, unknown> = {};

    if (ruleSimulation.hit) {
      provider = ruleSimulation.hit.provider;
      routeId = ruleSimulation.hit.routeId;
      routingSource = 'routing_rule';
      routingMetrics = ruleSimulation.hit.routingMetrics;
    } else {
      const cfgProvider = cfg?.provider != null ? String(cfg.provider).trim() : '';
      if (cfg && cfgProvider !== '') {
        fallbackDetail.model_config_provider = cfgProvider;
        if (!this.providerRegistry.hasAdapter(cfgProvider)) {
          warnings.push(`model_configs.provider="${cfgProvider}" 未注册 Adapter`);
        } else {
          provider = cfgProvider;
          routingSource = 'model_config_provider';
        }
      } else {
        const pathRes = this.tryResolveProviderFromModelPath(model);
        if (pathRes) {
          provider = pathRes.provider;
          routingSource = 'model_path';
          fallbackDetail.inferredFeatureTypeFromPath = pathRes.featureType;
        } else {
          warnings.push(
            '未命中路由规则，且 model_configs 无有效 provider、模型路径也无法解析为 provider（需至少两段，如 vendor/model）',
          );
        }
      }
    }

    const adapterRegistered = provider != null && this.providerRegistry.hasAdapter(provider);
    if (provider && !adapterRegistered) {
      warnings.push(`解析得到 provider="${provider}"，但当前进程未注册该 Adapter`);
    }

    return {
      at: at.toISOString(),
      model,
      apiKey,
      inferredFeatureType,
      configModelTypeUsed,
      modelConfig: cfg
        ? {
            model_id: cfg.model_id,
            model_type: cfg.model_type,
            provider: cfg.provider,
            disabled: cfg.disabled,
            provider_model_name: cfg.provider_model_name,
          }
        : null,
      warnings,
      ruleSimulation,
      resolution: {
        provider,
        routeId,
        routingSource,
        routingMetrics,
        fallbackDetail,
        adapterRegistered,
      },
    };
  }

  private normalizeFeatureTypeOption(opt: string): string {
    const camelToInternal: Record<string, string> = {
      textToImage: 'image_generate',
      imageToImage: 'image_to_image',
      textToVideo: 'text_to_video',
      imageToVideo: 'image_to_video',
      videoToVideo: 'image_to_video',
      characterFaceswap: 'character_swap',
      videoUpscale: 'video_upscale',
    };
    if (camelToInternal[opt]) return camelToInternal[opt];
    if (
      /^(image_generate|image_to_image|text_to_video|image_to_video|character_swap|video_upscale|unknown)$/.test(
        opt,
      )
    ) {
      return opt;
    }
    return opt;
  }

  private resolveTaskFeatureType(model: string, options?: Record<string, unknown>): string {
    const opt = options?.featureType;
    if (typeof opt === 'string' && opt.length > 0) {
      return this.normalizeFeatureTypeOption(opt);
    }
    const parts = model.split('/');
    const last = parts.length >= 1 ? parts[parts.length - 1] : model;
    return this.inferFeatureType(last);
  }

  private inferFeatureType(lastSegment: string): string {
    const map: Record<string, string> = {
      'text-to-image': 'image_generate',
      'image-to-image': 'image_to_image',
      edit: 'image_to_image',
      'edit-sequential': 'image_to_image',
      'text-to-video': 'text_to_video',
      'image-to-video': 'image_to_video',
      'reference-to-video': 'image_to_video',
      'video-to-video': 'image_to_video',
      'video-edit': 'image_to_video',
      'video-edit-fast': 'image_to_video',
      'motion-control': 'character_swap',
      animate: 'character_swap',
      'video-upscale': 'video_upscale',
    };
    return map[lastSegment] || 'unknown';
  }

  private tryResolveProviderFromModelPath(
    model: string,
  ): { provider: string; featureType: string } | null {
    const parts = model.split('/');
    if (parts.length < 2) return null;
    const provider = parts[0];
    const featureType = this.inferFeatureType(parts[parts.length - 1]);
    return { provider, featureType };
  }
}
