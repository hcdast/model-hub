import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: true, collection: 'audit_logs' })
export class AuditLog {
  @Prop({ required: true })
  action!: string;

  @Prop({ required: true })
  operator!: string;

  @Prop({ type: Object })
  detail?: Record<string, any>;

  @Prop()
  ip?: string;

  @Prop()
  resource?: string; // 资源类型

  @Prop()
  resourceId?: string; // 资源ID

  @Prop()
  result?: string; // 操作结果：success, failure

  @Prop()
  errorMessage?: string; // 错误信息（如果失败）

  @Prop({ type: Object })
  requestParams?: Record<string, any>; // 请求参数

  @Prop()
  userAgent?: string; // 用户代理
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ operator: 1, createdAt: -1 });
AuditLogSchema.index({ resource: 1, createdAt: -1 });
AuditLogSchema.index({ result: 1, createdAt: -1 });
AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 86400 },
);
