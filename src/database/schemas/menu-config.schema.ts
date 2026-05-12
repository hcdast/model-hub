import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** 菜单配置文档类型 */
export type MenuConfigDocument = HydratedDocument<MenuConfig>;

/**
 * 菜单配置 Schema
 * 存储系统管理后台的菜单项配置，支持一二级菜单结构
 */
@Schema({ timestamps: true, collection: 'menu_configs' })
export class MenuConfig {
  @Prop({ required: true, unique: true })
  key!: string; // 菜单项唯一标识

  @Prop({ required: true })
  label!: string; // 显示名称

  @Prop()
  path?: string; // 路由路径（一级分组可无路径）

  @Prop({ required: true })
  icon!: string; // 图标名称

  @Prop({ default: 0 })
  sortOrder!: number; // 排序权重（越小越靠前）

  @Prop()
  parentKey?: string; // 父级菜单 key（null 表示一级菜单）

  @Prop()
  requiredPermission?: string; // 所需权限代码

  @Prop({ default: true })
  enabled!: boolean; // 是否启用

  @Prop()
  moduleKey?: string; // 关联的功能模块 key

  @Prop({ type: [String], default: [] })
  associatedPermissions!: string[]; // 关联权限列表（提示用，不做自动绑定）
}

export const MenuConfigSchema = SchemaFactory.createForClass(MenuConfig);

// 性能索引
MenuConfigSchema.index({ key: 1 }, { unique: true });
MenuConfigSchema.index({ parentKey: 1 });
MenuConfigSchema.index({ moduleKey: 1 });
