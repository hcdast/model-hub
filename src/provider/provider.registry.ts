import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IProviderAdapter } from './interfaces/provider-adapter.interface';

@Injectable()
export class ProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly adapters = new Map<string, IProviderAdapter>();

  onModuleInit() {
    this.logger.log(
      `ProviderRegistry initialized with adapters: [${this.listProviders().join(', ')}]`,
    );
  }

  register(adapter: IProviderAdapter): void {
    this.adapters.set(adapter.providerName, adapter);
    this.logger.log(`Registered adapter: ${adapter.providerName}`);
  }

  getAdapter(provider: string): IProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  hasAdapter(provider: string): boolean {
    return this.adapters.has(provider);
  }

  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}
