import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true, collection: 'drama_workflow_links' })
export class DramaWorkflowLink {
  @Prop({ required: true, unique: true }) id!: string;
  @Prop({ required: true, index: true }) ownerId!: string;
  @Prop({ required: true, index: true }) projectId!: string;
  @Prop({ required: true }) shotId!: string;
  @Prop({ required: true }) kind!: 'image' | 'video';
  @Prop({ required: true }) sourceRevision!: number;
  @Prop({ required: true }) inputFingerprint!: string;
  @Prop({ required: true, unique: true }) workflowId!: string;
}
export const DramaWorkflowLinkSchema = SchemaFactory.createForClass(DramaWorkflowLink);
