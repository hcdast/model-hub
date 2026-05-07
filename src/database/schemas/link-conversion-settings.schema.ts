import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LinkConversionSettingsDocument =
  HydratedDocument<LinkConversionSettings>;

/**
 * 第三方链接转存配置（单例文档，config_key 固定为 global）
 */
@Schema({ timestamps: true, collection: 'link_conversion_settings' })
export class LinkConversionSettings {
  @Prop({ required: true, unique: true, index: true, default: 'global' })
  config_key!: string;

  /** 完整配置 JSON（与 DEFAULT 结构一致，持久化层可缺省字段由服务层合并默认值） */
  @Prop({ type: Object, required: true, default: {} })
  config!: Record<string, unknown>;

  @Prop({ default: 0 })
  revision!: number;
}

export const LinkConversionSettingsSchema = SchemaFactory.createForClass(
  LinkConversionSettings,
);
