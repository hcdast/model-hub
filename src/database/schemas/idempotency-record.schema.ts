import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type IdempotencyRecordDocument = HydratedDocument<IdempotencyRecord>;

@Schema({ timestamps: true, collection: 'idempotency_records' })
export class IdempotencyRecord {
  @Prop({ required: true })
  apiKey!: string;

  @Prop({ required: true })
  idempotencyKey!: string;

  @Prop({ required: true })
  taskId!: string;

  @Prop({ required: true, index: { expires: 0 } })
  expireAt!: Date;
}

export const IdempotencyRecordSchema =
  SchemaFactory.createForClass(IdempotencyRecord);

IdempotencyRecordSchema.index(
  { apiKey: 1, idempotencyKey: 1 },
  { unique: true },
);
