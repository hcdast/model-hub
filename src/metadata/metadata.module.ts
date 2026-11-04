import { MediaInputValidatorService } from './media-input-validator.service';
import { Module } from '@nestjs/common';
import { RemoteMetadataExtractorService } from './remote-metadata-extractor.service';

@Module({
  providers: [RemoteMetadataExtractorService, MediaInputValidatorService],
  exports: [RemoteMetadataExtractorService, MediaInputValidatorService],
})
export class MetadataModule {}
