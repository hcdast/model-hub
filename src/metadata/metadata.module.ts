import { Module } from '@nestjs/common';
import { RemoteMetadataExtractorService } from './remote-metadata-extractor.service';

@Module({
  providers: [RemoteMetadataExtractorService],
  exports: [RemoteMetadataExtractorService],
})
export class MetadataModule {}
