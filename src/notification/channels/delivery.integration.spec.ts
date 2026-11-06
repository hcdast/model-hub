import { createServer as httpServer } from 'http';
import { createServer as smtpServer, Socket } from 'net';
import { EmailChannel } from './email.channel';
import { WeComChannel } from './wecom.channel';
import { NotificationProcessor } from '../processors/notification.processor';

function auditModel() {
  const rows: any[] = [];
  const updateOne = jest.fn(async (filter: any, update: any, options?: any) => {
    let row = rows.find(item => String(item._id) === String(filter._id));
    if (!row && options?.upsert) { row = { _id: filter._id, ...update.$setOnInsert }; rows.push(row); }
    if (row && update.$set) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0 };
  });
  return { rows, updateOne };
}
function fixtureJob(data: any): any {
  return { data, attemptsMade: 0, update: jest.fn(async function(data: any) { this.data = JSON.parse(JSON.stringify(data)); }), discard: jest.fn() };
}
const event: any = { type: 'provider_circuit_open', severity: 'critical', timestamp: new Date(), payload: { model: '<img src=x onerror=alert(1)>', provider: 'fixture' } };
describe('Notification delivery against local protocol servers', () => {
  it('requires enterprise WeChat business acknowledgement and records failure after HTTP 200 rejection', async () => {
    let code = 93000, calls = 0;
    const server = httpServer((_req, res) => { calls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ errcode: code, errmsg: 'credential must never appear in logs' })); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const channel = new WeComChannel(); jest.spyOn(channel as any, 'sleep').mockResolvedValue(undefined);
    const model = auditModel(), records = model.rows;
    const processor = new NotificationProcessor(model as any, channel, new EmailChannel(), {} as any);
    const job = fixtureJob({ event, ruleId: 'test', ruleName: 'local-test', channelType: 'wecom', channelConfig: { webhookUrl: `http://127.0.0.1:${(server.address() as any).port}/?key=local-only-secret` }, recipients: [] });
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
    const model = auditModel(); const channel: any = { send: async () => { throw new Error('secret-token'); } };
    const processor = new NotificationProcessor(model as any, channel, {} as any, {} as any);
    await expect(processor.handleDispatch(fixtureJob({ event, ruleId: 'test', ruleName: 'fixture', channelType: 'wecom', channelConfig: {}, recipients: [] }))).rejects.toThrow('通知渠道执行异常');
    expect(model.rows[0]).toMatchObject({ status: 'failed', attemptCount: 1 });
    expect(JSON.stringify(model.rows)).not.toContain('secret-token');
  });
  it('does not ask Bull to repeat a partially accepted SMTP delivery', async () => {
    const model = auditModel(); const channel: any = { send: jest.fn(async () => ({ success: false, retryable: false, error: 'SMTP 部分投递失败' })) };
    const processor = new NotificationProcessor(model as any, {} as any, channel, {} as any);
    await processor.handleDispatch(fixtureJob({ event, ruleId: 'test', ruleName: 'fixture', channelType: 'email', channelConfig: {}, recipients: [] }));
    expect(model.rows[0]).toMatchObject({ status: 'failed' }); expect(channel.send).toHaveBeenCalledTimes(1);
  });
  it('does not send when the initial audit write fails, then safely resumes after recovery', async () => {
    const model = auditModel(); const channel: any = { send: jest.fn(async () => ({ success: true })) };
    const processor = new NotificationProcessor(model as any, channel, {} as any, {} as any);
    const job = fixtureJob({ event, ruleId: 'test', ruleName: 'fixture', channelType: 'wecom', channelConfig: {}, recipients: [] });
    model.updateOne.mockRejectedValueOnce(new Error('private-database-address'));
    await expect(processor.handleDispatch(job)).rejects.toThrow('通知审计记录写入失败');
    expect(channel.send).not.toHaveBeenCalled(); expect(job.data.delivery.phase).toBe('prepared');
    job.attemptsMade++;
    await processor.handleDispatch(job); expect(channel.send).toHaveBeenCalledTimes(1);
    expect(model.rows).toHaveLength(1); expect(model.rows[0].status).toBe('success');
  });
  it('keeps the delivery receipt on final write failure and retries only the audit write', async () => {
    const model = auditModel(); const channel: any = { send: jest.fn(async () => ({ success: true, responseData: { credential: 'never-store' } })) };
    const processor = new NotificationProcessor(model as any, channel, {} as any, {} as any);
    const job = fixtureJob({ event, ruleId: 'test', ruleName: 'fixture', channelType: 'wecom', channelConfig: {}, recipients: [] });
    const write = model.updateOne.getMockImplementation()!;
    model.updateOne.mockImplementationOnce(write).mockRejectedValueOnce(new Error('write unavailable'));
    await expect(processor.handleDispatch(job)).rejects.toThrow('通知审计记录写入失败');
    expect(job.data.delivery.phase).toBe('receipt'); expect(JSON.stringify(job.data.delivery)).not.toContain('never-store');
    expect(model.rows[0].status).toBe('pending'); job.attemptsMade++;
    await processor.handleDispatch(job); await processor.handleDispatch(job);
    expect(channel.send).toHaveBeenCalledTimes(1); expect(model.rows).toHaveLength(1); expect(model.rows[0].status).toBe('success');
  });
  it('stops automatic delivery on an interrupted sending checkpoint with no receipt', async () => {
    const model = auditModel(); const channel: any = { send: jest.fn(async () => ({ success: true })) };
    const processor = new NotificationProcessor(model as any, channel, {} as any, {} as any);
    const job = fixtureJob({ event, ruleId: 'test', ruleName: 'fixture', channelType: 'wecom', channelConfig: {}, recipients: [] });
    const update = job.update.getMockImplementation();
    job.update.mockImplementation(async function(this: any, data: any) {
      if (data.delivery?.phase === 'receipt') throw new Error('Receipt checkpoint unavailable');
      await update.call(this, data);
    });
    await expect(processor.handleDispatch(job)).rejects.toThrow('Receipt checkpoint unavailable');
    expect(job.data.delivery.phase).toBe('sending');
    await expect(processor.handleDispatch(job)).rejects.toThrow('禁止自动重发');
    expect(job.discard).toHaveBeenCalled(); expect(channel.send).toHaveBeenCalledTimes(1); expect(model.rows[0].status).toBe('unknown');
  });

});
