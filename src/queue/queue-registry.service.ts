import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';

export interface RegisteredQueue {
  name: string;
  queue: Queue;
  featureType: string;
  provider?: string;
}

@Injectable()
export class QueueRegistryService {
  private readonly logger = new Logger(QueueRegistryService.name);
  private readonly queues = new Map<string, RegisteredQueue>();

  register(entry: RegisteredQueue): void {
    this.queues.set(entry.name, entry);
    this.logger.log(`Queue registered: ${entry.name}`);
  }

  has(name: string): boolean {
    return this.queues.has(name);
  }

  getQueue(name: string): Queue | undefined {
    return this.queues.get(name)?.queue;
  }

  getEntry(name: string): RegisteredQueue | undefined {
    return this.queues.get(name);
  }

  getAllQueues(): RegisteredQueue[] {
    return Array.from(this.queues.values());
  }

  remove(name: string): boolean {
    const result = this.queues.delete(name);
    if (result) this.logger.log(`Queue removed: ${name}`);
    return result;
  }
}
