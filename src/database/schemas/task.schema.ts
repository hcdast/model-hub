import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { TaskStatus, CallbackStatus } from '../../common/constants/task-status';

export type TaskDocument = HydratedDocument<Task>;

@Schema({ timestamps: true, collection: 'tasks' })
export class Task {
  @Prop({ required: true })
  taskId!: string;

  @Prop({ required: true })
  clientId!: string;

  @Prop()
  bizId?: string;

  @Prop({ required: true })
  model!: string;

  @Prop({ required: true })
  provider!: string;

  @Prop()
  providerModel?: string;

  @Prop({ required: true })
  featureType!: string;

  @Prop()
  scene?: string;

  @Prop()
  routeId?: string;

  @Prop({
    required: true,
    enum: Object.values(TaskStatus),
    default: TaskStatus.PENDING,
    index: true,
  })
  status!: TaskStatus;

  @Prop({ default: 0 })
  version!: number;

  @Prop(
    raw({
      providerTaskId: { type: String },
      requestId: { type: String },
      rawMeta: { type: Object },
    }),
  )
  providerTask?: Record<string, any>;

  @Prop({ type: Object })
  requestPayload?: Record<string, any>;

  @Prop({ type: Object })
  resultPayload?: Record<string, any>;

  @Prop(
    raw({
      code: { type: String },
      message: { type: String },
      providerCode: { type: String },
      providerMessage: { type: String },
      retryable: { type: Boolean, default: false },
    }),
  )
  error?: Record<string, any>;

  @Prop(
    raw({
      url: { type: String },
      secret: { type: String },
      status: {
        type: String,
        enum: Object.values(CallbackStatus),
        default: CallbackStatus.PENDING,
      },
      retryCount: { type: Number, default: 0 },
      nextRetryAt: { type: Date },
      lastAttemptAt: { type: Date },
      lastError: { type: String },
    }),
  )
  callback?: Record<string, any>;

  @Prop(
    raw({
      nextPollAt: { type: Date },
      pollCount: { type: Number, default: 0 },
      lastPolledAt: { type: Date },
      pollInterval: { type: Number, default: 30000 },
      maxPollCount: { type: Number, default: 720 },
      maxDuration: { type: Number, default: 3600000 },
    }),
  )
  polling?: Record<string, any>;

  @Prop(
    raw({
      receivedAt: { type: Date },
      enqueuedAt: { type: Date },
      dequeuedAt: { type: Date },
      submittedAt: { type: Date },
      providerStartedAt: { type: Date },
      providerCompletedAt: { type: Date },
      completedAt: { type: Date },
      callbackSentAt: { type: Date },
      queueWaitMs: { type: Number },
      providerProcessMs: { type: Number },
      totalE2eMs: { type: Number },
      callbackDelayMs: { type: Number },
    }),
  )
  timing?: Record<string, any>;

  @Prop({ type: [{ event: String, timestamp: Date, detail: Object, durationFromPrev: Number }], default: [] })
  timeline?: Array<{ event: string; timestamp: Date; detail?: any; durationFromPrev?: number }>;

  @Prop({ default: 50 })
  priority!: number;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

TaskSchema.index({ taskId: 1 }, { unique: true });
TaskSchema.index({ status: 1, 'polling.nextPollAt': 1 });
TaskSchema.index({ clientId: 1, createdAt: -1 });
TaskSchema.index({ provider: 1, 'providerTask.providerTaskId': 1 });
TaskSchema.index({ 'callback.status': 1, 'callback.nextRetryAt': 1 });
// 有 bizId 时 (clientId,bizId) 唯一；无 bizId 不进入索引。旧库跑一次 scripts/fix-task-bizid-unique-index.cjs
TaskSchema.index(
  { clientId: 1, bizId: 1 },
  {
    unique: true,
    partialFilterExpression: { bizId: { $exists: true, $type: 'string', $gt: '' } },
  },
);
TaskSchema.index({ featureType: 1, status: 1, createdAt: -1 });
