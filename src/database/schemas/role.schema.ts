import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

@Schema({ timestamps: true, collection: 'roles' })
export class Role {
  @Prop({ required: true, unique: true })
  name!: string; // 角色名称，如 'super_admin', 'admin', 'operator'

  @Prop()
  displayName!: string; // 显示名称

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  permissions!: string[]; // 权限列表，如 ['user:create', 'user:read']

  @Prop({ default: false })
  isSystem!: boolean; // 是否为系统预定义角色

  @Prop({ default: true })
  enabled!: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);

// Performance indexes for RBAC queries
RoleSchema.index({ name: 1 }, { unique: true });
RoleSchema.index({ enabled: 1 });
RoleSchema.index({ isSystem: 1 });
