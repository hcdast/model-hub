import { Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AppConfigModule } from '../config/config.module';
import { ProviderRegistry } from './provider.registry';
import { ProviderConfigService } from './provider-config.service';
import { WaveSpeedAdapter } from './adapters/wavespeed.adapter';
import { CloudwiseAdapter } from './adapters/cloudwise.adapter';
import { AkoolAdapter } from './adapters/akool.adapter';
import { MiniMaxAdapter } from './adapters/minimax.adapter';
import { SeedanceAdapter } from './adapters/seedance.adapter';
import { WanAdapter } from './adapters/wan.adapter';
import { TencentAdapter } from './adapters/tencent.adapter';
import { AccountPoolModule } from './account-pool/account-pool.module';

@Module({
  imports: [DatabaseModule, AppConfigModule, AccountPoolModule],
  providers: [
    ProviderRegistry,
    ProviderConfigService,
    WaveSpeedAdapter,
    CloudwiseAdapter,
    AkoolAdapter,
    MiniMaxAdapter,
    SeedanceAdapter,
    WanAdapter,
    TencentAdapter,
  ],
  exports: [ProviderRegistry, ProviderConfigService, AccountPoolModule],
})
export class ProviderModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly waveSpeed: WaveSpeedAdapter,
    private readonly cloudwise: CloudwiseAdapter,
    private readonly akool: AkoolAdapter,
    private readonly minimax: MiniMaxAdapter,
    private readonly seedance: SeedanceAdapter,
    private readonly wan: WanAdapter,
    private readonly tencent: TencentAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this.waveSpeed);
    this.registry.register(this.cloudwise);
    this.registry.register(this.akool);
    this.registry.register(this.minimax);
    this.registry.register(this.seedance);
    this.registry.register(this.wan);
    this.registry.register(this.tencent);
  }
}
