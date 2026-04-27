import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApiClientDocument = HydratedDocument<ApiClient>;

@Schema({ timestamps: true, collection: 'api_clients' })
export class ApiClient {
  /** 公开 id，形如 mh_<ULID>；完整调用密钥为 `${clientId}.${secret}` */
  @Prop({ required: true, unique: true })
  clientId!: string;

  @Prop({ required: true })
  secretHash!: string;

  @Prop()
  name?: string;

  @Prop({ default: true })
  enabled!: boolean;

  /** 该 API 客户端提交任务时的默认优先级（0=最高, 100=最低） */
  @Prop({ default: 50, min: 0, max: 100 })
  defaultPriority!: number;
}

export const ApiClientSchema = SchemaFactory.createForClass(ApiClient);
