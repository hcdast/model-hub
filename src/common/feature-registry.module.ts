import { Global, Module, OnModuleInit } from '@nestjs/common';
import { FeatureRegistryService } from './services/feature-registry.service';
import { builtInDescriptors } from './descriptors';

@Global()
@Module({
  providers: [
    FeatureRegistryService,
    {
      provide: 'BUILTIN_DESCRIPTORS_INIT',
      useFactory: (registry: FeatureRegistryService) => {
        for (const desc of builtInDescriptors) {
          registry.registerDescriptor(desc);
        }
        return true;
      },
      inject: [FeatureRegistryService],
    },
  ],
  exports: [FeatureRegistryService],
})
export class FeatureRegistryModule {}
