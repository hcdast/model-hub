import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import {
  InAppNotification,
  InAppNotificationDocument,
} from '../../database/schemas/in-app-notification.schema';

export interface InAppNotificationFilters {
  read?: boolean;
}

export interface PaginatedInAppResult {
  items: InAppNotificationDocument[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class InAppNotificationService {
  constructor(
    @InjectModel(InAppNotification.name)
    private readonly inAppModel: Model<InAppNotificationDocument>,
  ) {}

  async query(
    filters: InAppNotificationFilters = {},
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedInAppResult> {
    const query: FilterQuery<InAppNotificationDocument> = {};
    if (filters.read !== undefined) {
      query.read = filters.read;
    }

    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.inAppModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.inAppModel.countDocuments(query).exec(),
    ]);

    return { items, total, page, pageSize };
  }

  async markRead(id: string): Promise<InAppNotificationDocument | null> {
    return this.inAppModel
      .findByIdAndUpdate(id, { $set: { read: true, readAt: new Date() } }, { new: true })
      .exec();
  }

  async markAllRead(): Promise<number> {
    const result = await this.inAppModel
      .updateMany({ read: false }, { $set: { read: true, readAt: new Date() } })
      .exec();
    return result.modifiedCount;
  }

  async unreadCount(): Promise<number> {
    return this.inAppModel.countDocuments({ read: false }).exec();
  }
}
