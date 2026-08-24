/*
 * Portal Refresh Token Schema
 * 开发者门户用户 Refresh Token 管理
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PortalRefreshTokenDocument = HydratedDocument<PortalRefreshToken>;

@Schema({ timestamps: true, collection: 'portal_refresh_tokens' })
export class PortalRefreshToken {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  tokenId!: string;

  @Prop({ required: true, select: false })
  secretHash!: string;

  @Prop({ required: true })
  familyId!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  userAgent?: string;

  @Prop()
  ip?: string;

  @Prop()
  revokedAt?: Date;

  @Prop()
  replacedByTokenId?: string;

  @Prop({ default: true })
  isValid!: boolean;
}

export const PortalRefreshTokenSchema = SchemaFactory.createForClass(PortalRefreshToken);

// 索引
PortalRefreshTokenSchema.index({ tokenId: 1 }, { unique: true });
PortalRefreshTokenSchema.index({ familyId: 1, isValid: 1 });
PortalRefreshTokenSchema.index({ userId: 1 });
PortalRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
