import { createServer as httpServer } from 'http';
import { createServer as smtpServer, Socket } from 'net';
import { EmailChannel } from './email.channel';
import { WeComChannel } from './wecom.channel';
import { NotificationProcessor } from '../processors/notification.processor';

const event: any = { type: 'provider_circuit_open', severity: 'critical', timestamp: new Date(), payload: { model: '<img src=x onerror=alert(1)>', provider: 'fixture' } };
describe('Notification delivery against local protocol servers', () => {
  it('requires enterprise WeChat business acknowledgement and records failure after HTTP 200 rejection', async () => {
    let code = 93000, calls = 0;
    const server = httpServer((_req, res) => { calls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ errcode: code, errmsg: 'credential must never appear in logs' })); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const channel = new WeComChannel(); jest.spyOn(channel as any, 'sleep').mockResolvedValue(undefined);
    const records: any[] = [], model: any = { create: async (record: any) => records.push(record) };
    const processor = new NotificationProcessor(model, channel, new EmailChannel(), {} as any);
    const job: any = { attemptsMade: 0, data: { event, ruleId: 'test', ruleName: 'local-test', channelType: 'wecom', channelConfig: { webhookUrl: `http://127.0.0.1:${(server.address() as any).port}/?key=local-only-secret` }, recipients: [] } };
    try {
      await expect(processor.handleDispatch(job)).rejects.toThrow('业务码 93000');
      expect(calls).toBe(3); expect(records).toHaveLength(1); expect(records[0].status).toBe('failed');
      expect(JSON.stringify(records)).not.toContain('local-only-secret');
      code = 0; await processor.handleDispatch(job); expect(records[1].status).toBe('success');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('performs an actual local SMTP exchange, escapes HTML, and reports partial rejection without resending', async () => {
    const deliveries: string[] = [], sockets = new Set<Socket>();
    const server = smtpServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.write('220 localhost test SMTP\r\n'); let buffer = '', data = false, message = '';
      socket.on('data', chunk => {
        buffer += chunk.toString();
        while (buffer.includes('\r\n')) {
          const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (data) { if (line === '.') { deliveries.push(message); data = false; socket.write('250 accepted\r\n'); } else message += line + '\r\n'; continue; }
          if (/^EHLO|^HELO/.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
          else if (/^AUTH/.test(line)) socket.write('235 authenticated\r\n');
          else if (/^RCPT.*reject@/i.test(line)) socket.write('550 recipient rejected\r\n');
          else if (/^DATA/.test(line)) { data = true; message = ''; socket.write('354 end with dot\r\n'); }
          else if (/^QUIT/.test(line)) { socket.end('221 bye\r\n'); }
          else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = { smtpHost: '127.0.0.1', smtpPort: (server.address() as any).port, smtpUser: 'fixture', smtpPass: 'fixture', from: 'test@example.invalid' };
    const channel = new EmailChannel();
    jest.spyOn(channel as any, 'sleep').mockResolvedValue(undefined);
    try {
      expect(await channel.send(event, config, ['accept@example.invalid'])).toMatchObject({ success: true });
      expect(deliveries).toHaveLength(1); expect(deliveries[0]).toContain('&lt;img'); expect(deliveries[0]).not.toContain('<img');
      expect(await channel.send(event, config, ['accept@example.invalid', 'reject@example.invalid'])).toMatchObject({ success: false, error: expect.stringContaining('部分投递失败') });
      expect(deliveries).toHaveLength(2);
      const rejected = await channel.send(event, config, ['reject@example.invalid']);
      expect(rejected).toMatchObject({ success: false, error: 'SMTP 投递失败（EENVELOPE / 550）' });
      expect(JSON.stringify(rejected)).not.toContain('reject@example.invalid'); expect(deliveries).toHaveLength(2);
    } finally { sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('records thrown channel errors without retaining secrets', async () => {
    const create = jest.fn(); const channel: any = { send: async () => { throw new Error('secret-token'); } };
    const processor = new NotificationProcessor({ create } as any, channel, {} as any, {} as any);
    await expect(processor.handleDispatch({ attemptsMade: 0, data: { event, ruleId: 'test', ruleName: 'fixture', channelType: 'wecom', channelConfig: {}, recipients: [] } } as any)).rejects.toThrow('通知渠道执行异常');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', attemptCount: 1 }));
    expect(JSON.stringify(create.mock.calls)).not.toContain('secret-token');
  });
  it('does not ask Bull to repeat a partially accepted SMTP delivery', async () => {
    const create = jest.fn(); const channel: any = { send: jest.fn(async () => ({ success: false, retryable: false, error: 'SMTP 部分投递失败' })) };
    const processor = new NotificationProcessor({ create } as any, {} as any, channel, {} as any);
    await processor.handleDispatch({ attemptsMade: 0, data: { event, ruleId: 'test', ruleName: 'fixture', channelType: 'email', channelConfig: {}, recipients: [] } } as any);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' })); expect(channel.send).toHaveBeenCalledTimes(1);
  });
});
