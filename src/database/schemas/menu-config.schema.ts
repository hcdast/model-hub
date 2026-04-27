import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MenuConfigDocument = HydratedDocument<MenuConfig>;

@Schema({ timestamps: true, collection: 'menu_configs' })
export class MenuConfig {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true })
  label!: string;

  @Prop()
  path?: string;

  @Prop({ required: true })
  icon!: string;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop()
  parentKey?: string;

  @Prop()
  requiredPermission?: string;

  @Prop({ default: true })
  enabled!: boolean;

  @Prop()
  moduleKey?: string;
}

export const MenuConfigSchema = SchemaFactory.createForClass(MenuConfig);

MenuConfigSchema.index({ key: 1 }, { unique: true });
MenuConfigSchema.index({ parentKey: 1 });
MenuConfigSchema.index({ moduleKey: 1 });
