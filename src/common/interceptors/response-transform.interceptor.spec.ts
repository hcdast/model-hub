import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { ResponseTransformInterceptor } from './response-transform.interceptor';

function createContext(): ExecutionContext {
  return {} as ExecutionContext;
}

describe('ResponseTransformInterceptor', () => {
  const interceptor = new ResponseTransformInterceptor();

  it('wraps plain payloads as code/message/data', (done) => {
    const next: CallHandler = { handle: () => of({ hello: 1 }) };
    interceptor.intercept(createContext(), next).subscribe((out: any) => {
      expect(out).toEqual({ code: 0, message: 'Success', data: { hello: 1 } });
      done();
    });
  });

  it('passes through object with code and preserves existing message', (done) => {
    const next: CallHandler = { handle: () => of({ code: 0, message: 'OK', data: { a: 1 } }) };
    interceptor.intercept(createContext(), next).subscribe((out: any) => {
      expect(out).toEqual({ code: 0, message: 'OK', data: { a: 1 } });
      done();
    });
  });

  it('fills default message when code present but message missing', (done) => {
    const next: CallHandler = { handle: () => of({ code: 0, data: { x: 2 } }) };
    interceptor.intercept(createContext(), next).subscribe((out: any) => {
      expect(out.code).toBe(0);
      expect(out.message).toBe('Success');
      expect(out.data).toEqual({ x: 2 });
      done();
    });
  });

  it('fills default message when message is blank', (done) => {
    const next: CallHandler = { handle: () => of({ code: 0, message: '   ', data: null }) };
    interceptor.intercept(createContext(), next).subscribe((out: any) => {
      expect(out.message).toBe('Success');
      done();
    });
  });
});
