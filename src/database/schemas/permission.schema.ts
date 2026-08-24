import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PermissionDocument = HydratedDocument<Permission>;

@Schema({ timestamps: true, collection: 'permissions' })
export class Permission {
  @Prop({ required: true, unique: true })
  code!: string; // 权限代码，如 'user:create'

  @Prop({ required: true })
  resource!: string; // 资源类型，如 'user', 'role', 'model'

  @Prop({ required: true })
  action!: string; // 操作类型，如 'create', 'read', 'update', 'delete'

  @Prop()
  displayName!: string;

  @Prop()
  description?: string;

  @Prop()
  module!: string; // 所属模块，如 'user-management', 'model-management'

  @Prop({ default: false })
  deprecated!: boolean; // 是否已废弃（描述符中不再声明但数据库中仍存在）
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);

// Performance indexes for RBAC queries
PermissionSchema.index({ module: 1 });
PermissionSchema.index({ resource: 1, action: 1 });
