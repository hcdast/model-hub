import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorkflowAssetDocument = HydratedDocument<WorkflowAsset>;

@Schema({ timestamps: true, collection: 'workflow_assets' })
export class WorkflowAsset {
  @Prop({ required: true, unique: true }) id!: string;
  @Prop({ required: true }) ownerId!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true, enum: ['image', 'video', 'audio', 'text'] }) kind!: string;
  @Prop({ required: true }) url!: string;
  @Prop() text?: string;
  @Prop({ required: true }) mimeType!: string;
  @Prop() size?: number;
  @Prop({ required: true, enum: ['upload', 'output-reference', 'output-text', 'drama-archive'] }) source!: string;
  @Prop() workflowId?: string;
  @Prop() runId?: string;
  @Prop() nodeId?: string;
}

export const WorkflowAssetSchema = SchemaFactory.createForClass(WorkflowAsset);
WorkflowAssetSchema.index({ ownerId: 1, createdAt: -1, id: 1 });
