import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { DramaPlan } from '../short-drama/drama.types';
import type { WorkflowDefinition } from '../database/schemas/workflow-template.schema';

@Schema({ timestamps: true, collection: 'creation_template_submissions' })
export class CreationTemplateSubmission {
  @Prop({ required: true, index: true }) ownerId!: string;
  @Prop({ required: true, enum: ['workflow', 'short-drama'] }) kind!: 'workflow' | 'short-drama';
  @Prop({ required: true }) sourceId!: string;
  @Prop({ required: true }) sourceRevision!: number;
  @Prop({ required: true }) sourceFingerprint!: string;
  @Prop({ required: true, maxlength: 100 }) name!: string;
  @Prop({ required: true, maxlength: 2000 }) description!: string;
  @Prop({ required: true, maxlength: 4000 }) instructions!: string;
  @Prop({ default: 'pending', enum: ['pending', 'published', 'rejected', 'withdrawn'] }) status!: string;
  @Prop({ type: Object, select: false }) dramaPlan?: DramaPlan;
  @Prop({ type: Object, select: false }) workflowDefinition?: WorkflowDefinition;
  @Prop({ default: '' }) reviewNote!: string;
  @Prop() reviewedAt?: Date;
}
export const CreationTemplateSubmissionSchema = SchemaFactory.createForClass(CreationTemplateSubmission);
CreationTemplateSubmissionSchema.index({ ownerId: 1, kind: 1, sourceId: 1, sourceFingerprint: 1 }, { unique: true });
