import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';

@Injectable()
export class CallbackSignatureService {
  sign(payload: string, secret: string, timestamp: number): string {
    const signatureString = `${timestamp}.${payload}`;
    return createHmac('sha256', secret).update(signatureString).digest('hex');
  }

  verify(
    payload: string,
    secret: string,
    timestamp: number,
    signature: string,
  ): boolean {
    const expected = this.sign(payload, secret, timestamp);
    return expected === signature;
  }
}
