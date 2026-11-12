import { HttpException, Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('Rate-limit error responses', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}); });
  afterEach(() => jest.restoreAllMocks());
  it.each([37, 0, -1, '37', undefined])('publishes a retry delay only when it is a positive numeric value: %s', retryAfter => {
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const request = { path: '/v1/auth/login', url: '/v1/auth/login', method: 'POST' };
    const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) };
    new GlobalExceptionFilter().catch(new HttpException({ message: 'Try later', retryAfter }, 429), host as any);
    expect(response.status).toHaveBeenCalledWith(429);
    if (retryAfter === 37) {
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 37);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: 37 }));
    } else {
      expect(response.setHeader).not.toHaveBeenCalled();
      expect(response.json.mock.calls[0][0]).not.toHaveProperty('retryAfter');
    }
  });
});
