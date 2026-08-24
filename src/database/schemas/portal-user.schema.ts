/*
 * Portal User Schema
 * 开发者门户用户数据模型
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PortalUserDocument = HydratedDocument<PortalUser>;

@Schema({ timestamps: true, collection: 'portal_users' })
export class PortalUser {
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, trim: true })
  username!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop()
  avatar?: string;

  @Prop({ default: 'user', enum: ['user', 'admin', 'vip'] })
  role!: string;

  @Prop({ default: 'active', enum: ['active', 'suspended', 'pending'] })
  status!: string;

  @Prop()
  emailVerifiedAt?: Date;

  @Prop()
  lastLoginAt?: Date;

  @Prop()
  lastLoginIp?: string;

  // 用量统计
  @Prop({ type: Object, default: { totalWorkflows: 0, totalRuns: 0, totalTokens: 0 } })
  usage!: {
    totalWorkflows: number;
    totalRuns: number;
    totalTokens: number;
  };
  @Prop({ default: 0, min: 0 })
  workflowCount!: number;



  // 软删除
  @Prop()
  deletedAt?: Date;

  // timestamps 会自动添加
  createdAt?: Date;
  updatedAt?: Date;
}

export const PortalUserSchema = SchemaFactory.createForClass(PortalUser);

// 索引
PortalUserSchema.index({ email: 1 }, { unique: true });
PortalUserSchema.index({ username: 1 });
PortalUserSchema.index({ status: 1, deletedAt: 1 });
PortalUserSchema.index({ createdAt: -1 });
