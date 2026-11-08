import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'creation_events', timestamps: false })
export class CreationEvent {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) kind!: string;
  @Prop({ required: true }) subject!: string;
  @Prop() templateId?: string;
  @Prop() projectId?: string;
  @Prop({ required: true }) at!: Date;
}
export const CreationEventSchema = SchemaFactory.createForClass(CreationEvent);
CreationEventSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 86400 });
CreationEventSchema.index({ kind: 1, name: 1, at: -1 });
