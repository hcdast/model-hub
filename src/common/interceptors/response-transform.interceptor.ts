import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'code' in data) {
          const o = data as Record<string, unknown>;
          // 统一业务响应 envelope：必有可读 message（与 GlobalExceptionFilter 的 message 字段对齐）
          if (typeof o.message !== 'string' || o.message.trim() === '') {
            return { ...o, message: 'Success' } as ApiResponse<T>;
          }
          return data as ApiResponse<T>;
        }
        return { code: 0, message: 'Success', data };
      }),
    );
  }
}
