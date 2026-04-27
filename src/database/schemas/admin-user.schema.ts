import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AdminUserDocument = HydratedDocument<AdminUser>;

@Schema({ timestamps: true, collection: 'admin_users' })
export class AdminUser {
  @Prop({ required: true, unique: true })
  username!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ type: [String], default: [] })
  roles!: string[]; // 改为数组，支持多角色

  @Prop({ default: true })
  enabled!: boolean;

  @Prop()
  lastLoginAt?: Date;

  @Prop()
  email?: string;

  @Prop()
  displayName?: string;

  @Prop({ default: false })
  requirePasswordChange!: boolean; // 是否需要修改密码

  @Prop()
  deletedAt?: Date; // 软删除标记
}

export const AdminUserSchema = SchemaFactory.createForClass(AdminUser);

// Performance indexes for RBAC queries
AdminUserSchema.index({ username: 1 }, { unique: true });
AdminUserSchema.index({ deletedAt: 1, enabled: 1 });
AdminUserSchema.index({ roles: 1 });
AdminUserSchema.index({ deletedAt: 1, createdAt: -1 });
