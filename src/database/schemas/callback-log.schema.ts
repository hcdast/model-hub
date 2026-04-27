import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CallbackLogDocument = HydratedDocument<CallbackLog>;

@Schema({ timestamps: true, collection: 'callback_logs' })
export class CallbackLog {
  @Prop({ required: true, index: true })
  taskId!: string;

  @Prop({ required: true })
  callbackUrl!: string;

  @Prop({ required: true })
  attempt!: number;

  @Prop({ type: Object })
  requestHeaders?: Record<string, any>;

  @Prop({ type: Object })
  requestBody?: Record<string, any>;

  @Prop()
  responseCode?: number;

  @Prop()
  responseBody?: string;

  @Prop({ required: true })
  success!: boolean;

  @Prop()
  error?: string;

  @Prop()
  latencyMs?: number;
}

export const CallbackLogSchema = SchemaFactory.createForClass(CallbackLog);

CallbackLogSchema.index({ taskId: 1, attempt: 1 });
CallbackLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });
