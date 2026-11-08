import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
@Schema({ timestamps: true, collection: 'drama_workflow_budget_tasks' })
export class WorkflowBudgetTask {
  @Prop({ required: true, unique: true }) id!: string;
  @Prop({ required: true }) ownerId!: string;
  @Prop({ required: true }) projectId!: string;
  @Prop({ required: true }) runId!: string;
  @Prop({ required: true }) nodeId!: string;
  @Prop({ required: true }) attempt!: number;
  @Prop({ required: true }) amount!: number;
  @Prop({ required: true }) inputHash!: string;
  @Prop({ default: 'ready', enum: ['ready', 'submitting', 'bound', 'settled'] }) state!: string;
  @Prop() taskId?: string;
}
export const WorkflowBudgetTaskSchema = SchemaFactory.createForClass(WorkflowBudgetTask);
WorkflowBudgetTaskSchema.index({ ownerId: 1, projectId: 1, state: 1 });
