import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { DramaPlan, DramaKind, DramaReference } from './drama.types';

@Schema({ timestamps: true, collection: 'short_drama_projects' })
export class ShortDramaProject {
  @Prop({ required: true, unique: true }) id!: string;
  @Prop({ required: true, index: true }) ownerId!: string;
  @Prop({ default: 0 }) revision!: number;
  @Prop({ type: Object, required: true }) plan!: DramaPlan;
  @Prop({ default: 100 }) budgetLimit!: number;
  @Prop({ type: Array, default: [] }) budgetHolds!: Array<{ quoteId: string; amount: number; settled: boolean }>;
  @Prop({ default: false }) archived!: boolean;
  @Prop({ type: Object }) templateSource?: { id: string; version: number };
  @Prop({ type: Array, default: [] }) stageTemplates!: Array<{ id: string; version: number; stage: string; appliedAt: Date; revision: number }>;
  @Prop() synchronizedAt?: Date;
  @Prop({ type: Array, default: [] }) history!: Array<{ revision: number; plan: DramaPlan; savedAt: Date }>;
}
export type DramaProjectDocument = HydratedDocument<ShortDramaProject>;
export const ShortDramaProjectSchema = SchemaFactory.createForClass(ShortDramaProject);
ShortDramaProjectSchema.index({ ownerId: 1, updatedAt: -1 });
ShortDramaProjectSchema.index({ 'templateSource.id': 1, ownerId: 1 });

@Schema({ timestamps: true, collection: 'short_drama_candidates' })
export class ShortDramaCandidate {
  @Prop({ type: Object }) renderSource?: import('./drama-version').DramaRenderSource;
  @Prop({ required: true, unique: true }) id!: string;
  @Prop({ required: true }) ownerId!: string;
  @Prop({ required: true, index: true }) projectId!: string;
  @Prop({ required: true }) kind!: DramaKind;
  @Prop({ required: true }) targetId!: string;
  @Prop({ required: true }) source!: 'model' | 'upload' | 'render' | 'workflow';
  @Prop({ type: Object }) workflowOrigin?: { workflowId: string; runId: string; nodeId: string; workflowVersion: number; definitionHash?: string; sourceRevision: number };
  @Prop({ default: 'pending' }) status!: string;
  @Prop() taskId?: string;
  @Prop({ select: false }) billingKey?: string;
  @Prop() url?: string;
  @Prop() measuredVoiceSeconds?: number;
  @Prop({ select: false }) measuredVoiceUrl?: string;
  @Prop({ type: Object, select: false }) measuredVisual?: { width: number; height: number; seconds?: number };
  @Prop({ select: false }) measuredVisualUrl?: string;
  @Prop({ type: Object, select: false }) speechAnalysis?: { seconds: number; windows: Array<{ start: number; end: number }> };
  @Prop({ select: false }) speechAnalysisUrl?: string;
  @Prop() text?: string;
  @Prop() error?: string;
  @Prop() inputFingerprint?: string;
  @Prop({ type: Array, default: undefined }) references?: DramaReference[];
  @Prop() manualReferenceCount?: number;
  @Prop() assetId?: string;
  @Prop() archiveStatus?: string;
  @Prop() archiveError?: string;
  @Prop() archiveLeaseUntil?: Date;
  @Prop() completedAt?: Date;
  @Prop() notificationReadAt?: Date;
  @Prop({ type: Object, select: false }) outputSchema?: Record<string, any>;
}
export const ShortDramaCandidateSchema = SchemaFactory.createForClass(ShortDramaCandidate);
ShortDramaCandidateSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
ShortDramaCandidateSchema.index({ ownerId: 1, completedAt: -1 });

@Schema({ timestamps: true, collection: 'short_drama_quotes' })
export class ShortDramaQuote {
  @Prop({ required: true, unique: true }) id!: string;
  @Prop({ required: true }) ownerId!: string;
  @Prop({ required: true }) projectId!: string;
  @Prop({ required: true }) revision!: number;
  @Prop({ required: true }) kind!: DramaKind;
  @Prop({ type: Object, required: true }) model!: Record<string, any>;
  @Prop({ type: Array, required: true }) items!: Array<{ id: string; targetId: string; input: Record<string, any>; fingerprint: string; ceiling?: number; references?: DramaReference[]; omittedReferences?: DramaReference[]; manualReferenceCount?: number }>;
  @Prop({ required: true }) estimatedCost!: number;
  @Prop({ required: true }) expiresAt!: Date;
  @Prop({ default: 'quoted' }) status!: string;
  @Prop() leaseUntil?: Date;
}
export const ShortDramaQuoteSchema = SchemaFactory.createForClass(ShortDramaQuote);
ShortDramaQuoteSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
