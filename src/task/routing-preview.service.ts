import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { ProviderRegistry } from '../provider/provider.registry';
import {
  listKnownServiceKeys,
  mapModelConfigServiceToProvider,
} from './model-service-provider.map';
import { ProviderRoutingService, RoutingRuleSimulationResult } from './provider-routing.service';

export interface RoutingPreviewInput {
  model: string;
  clientId: string;
  /** 与创建任务 options.featureType 一致；不传则按 model 路径推断 */
  featureType?: string;
  options?: Record<string, unknown>;
  at?: Date;
}

export interface RoutingPreviewResult {
  at: string;
  model: string;
  clientId: string;
  inferredFeatureType: string;
  modelTypeUsed: number | null;
  modelConfig: {
    model_name: string;
    model_type?: number;
    service?: string;
    disabled?: boolean;
    provider_model_name?: string;
  } | null;
  warnings: string[];
  ruleSimulation: RoutingRuleSimulationResult;
  resolution: {
    provider: string | null;
    routeId?: string;
    routingSource: 'routing_rule' | 'model_config_service' | 'model_path' | 'unresolved';
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
    const clientId = input.clientId.trim();
    const warnings: string[] = [];

    const inferredFeatureType = input.featureType?.trim()
      ? this.normalizeFeatureTypeOption(input.featureType.trim())
      : this.resolveTaskFeatureType(model, input.options);
    const modelTypeUsed = this.featureTypeToModelType(inferredFeatureType);

    const cfg = await this.modelConfigModel
      .findOne({
        model_name: model,
        ...(modelTypeUsed != null ? { model_type: modelTypeUsed } : {}),
      })
      .lean();

    if (cfg?.disabled) {
      warnings.push('该模型在 model_configs 中已禁用，实际创建任务将返回错误');
    }

    const ruleSimulation = await this.providerRouting.simulateFromRules(model, clientId, at);

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
      const svcRaw = cfg?.service != null ? String(cfg.service).trim() : '';
      if (cfg && svcRaw !== '') {
        const mapped = mapModelConfigServiceToProvider(cfg.service);
        fallbackDetail.model_config_service = svcRaw;
        fallbackDetail.mappedProvider = mapped;
        if (!mapped) {
          warnings.push(
            `model_configs.service="${svcRaw}" 无对应 Adapter，支持: ${listKnownServiceKeys().join(', ')}`,
          );
        } else {
          provider = mapped;
          routingSource = 'model_config_service';
        }
      } else {
        const pathRes = this.tryResolveProviderFromModelPath(model);
        if (pathRes) {
          provider = pathRes.provider;
          routingSource = 'model_path';
          fallbackDetail.inferredFeatureTypeFromPath = pathRes.featureType;
        } else {
          warnings.push(
            '未命中路由规则，且 model_configs 无 service、模型路径也无法解析为 provider（需至少两段，如 vendor/model）',
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
      clientId,
      inferredFeatureType,
      modelTypeUsed,
      modelConfig: cfg
        ? {
            model_name: cfg.model_name,
            model_type: cfg.model_type,
            service: cfg.service != null ? String(cfg.service) : undefined,
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

  private featureTypeToModelType(featureType: string): number | null {
    const map: Record<string, number> = {
      image_generate: 40001,
      textToImage: 40001,
      image_to_image: 40002,
      imageToImage: 40002,
      text_to_video: 1502,
      textToVideo: 1502,
      image_to_video: 1501,
      imageToVideo: 1501,
      character_swap: 40004,
      characterFaceswap: 40004,
      video_upscale: 40005,
      videoUpscale: 40005,
    };
    return map[featureType] ?? null;
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
