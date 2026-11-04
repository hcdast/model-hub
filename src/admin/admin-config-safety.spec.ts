import { BadRequestException, ConflictException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ModelConfigService } from './model-config.service';
import { mapModelImport } from './utils/model-import';
import { redactAdminData } from './utils/redact-admin-data';
import { NotificationService } from '../notification/services/notification.service';
import { adminRuleDisplay } from '../notification/services/admin-rule-display';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { TaskService } from '../task/task.service';
import { TaskStatus } from '../common/constants/task-status';

describe('Admin configuration safety', () => {
  const config = { model_id: 'test/model', model_name: 'Test', provider_model_name: 'test/model', provider: 'akool-maas', model_type: 'textToImage', disabled: true, params: {}, unit_price_map: {} };
  it('maps only the six MaaS capabilities, accepts native exports and preserves icon and hidden defaults', () => {
    const source = { items: [{ ...config, provider: 'maas', model_type: 1501, icon: 'https://example.com/icon.png', params: { model: { type: 'string', internal: true, configs: [{ value: 'supplier/model', default: true }] } } }, config, { ...config, model_type: 50001 }, { ...config, provider: 'other' }] };
    const result = mapModelImport(source);
    expect(result.excluded).toBe(2); expect(result.rows).toHaveLength(2);
    expect(result.rows[0].config).toMatchObject({ provider: 'akool-maas', model_type: 'imageToVideo', icon: 'https://example.com/icon.png', params: { model: { hide: true, default: 'supplier/model', enum: ['supplier/model'] } } });
  });
  it('blocks unsupported legacy rules instead of losing them', () => {
    const result = mapModelImport([{ ...config, params_rules: [{ when: {}, effects: [] }] }]);
    expect(result.rows[0].errors.length).toBeGreaterThan(0);
  });
  it('binds import plans to the actor, preserves live prices and status by default, and consumes plans once', async () => {
    const live = { ...config, _id: '507f1f77bcf86cd799439011', disabled: false, revision: 3, unit_price_map: { default: { unit_credit: 2, sale_unit_price: 1, cost_unit_price: 0 } } };
    const model: any = { findOne: () => ({ lean: async () => live }) };
    const service = new ModelConfigService(model);
    const update = jest.spyOn(service, 'updateConfig').mockResolvedValue(live as any);
    const preview = await service.previewImport({ source: [config] }, 'editor');
    expect(preview.rows[0].config.disabled).toBe(false); expect(preview.rows[0].config.unit_price_map).toEqual(live.unit_price_map);
    await expect(service.commitImport(preview.planId, 'other')).rejects.toThrow();
    expect((await service.commitImport(preview.planId, 'editor')).success).toBe(1);
    expect(update).toHaveBeenCalledWith(live._id, expect.objectContaining({ expected_revision: 3 }), 'editor');
    await expect(service.commitImport(preview.planId, 'editor')).rejects.toThrow();
  });
  it('rejects editing-time revision conflicts and removal of referenced price tiers', async () => {
    const live: any = { ...config, revision: 3, params: { duration: { type: 'integer', required: false } }, pricing: { tier_rules: [{ when: [{ field: 'duration', operator: 'present' }], tier: 'hd' }] }, unit_price_map: { hd: { unit_credit: 1, sale_unit_price: 1, cost_unit_price: 0 } } };
    live.toObject = () => ({ ...live });
    const db: any = { findById: async () => live, findOneAndUpdate: jest.fn() };
    const service = new ModelConfigService(db);
    await expect(service.updateConfig('id', { expected_revision: 2 }, 'editor')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateConfig('id', { expected_revision: 3, unit_price_map: { default: { unit_credit: 1, sale_unit_price: 1, cost_unit_price: 0 } } }, 'editor')).rejects.toThrow();
    expect(db.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('never returns SMTP passwords or webhook keys, retaining blank passwords on edit', async () => {
    const live = { channelType: 'email', channelConfig: { smtpHost: 'smtp.example.com', smtpPort: 465, smtpUser: 'test', smtpPass: 'test-secret', from: 'test@example.com' } };
    const db: any = { findById: () => ({ lean: () => ({ exec: async () => live }) }), findByIdAndUpdate: jest.fn(() => ({ exec: async () => live })) };
    const service = new NotificationService(db, {} as any, {} as any, {} as any, {} as any);
    await service.updateRule('id', { channelConfig: { smtpPass: '' } });
    expect(db.findByIdAndUpdate.mock.calls[0][1].$set.channelConfig.smtpPass).toBe('test-secret');
    expect(adminRuleDisplay(live).channelConfig.smtpPass).toBeUndefined();
    expect(adminRuleDisplay({ channelConfig: { webhookUrl: 'https://example.com/?token=test' } }).channelConfig.webhookUrl).toBeUndefined();
    await expect(service.updateRule('id', { cooldownMs: -1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('redacts callback headers, URL secrets and JSON response credentials without changing dates', () => {
    const date = new Date();
    const result = redactAdminData({ createdAt: date, callbackUrl: 'https://user:pass@example.com/path?key=secret', requestHeaders: { Authorization: 'Bearer test', 'X-ModelHub-Signature': 'test' }, responseBody: '{"password":"test-secret"}' });
    expect(result.createdAt).toBe(date); expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(result.callbackUrl).toBe('https://example.com/path?redacted'); expect(result.requestHeaders.Authorization).toBe('[REDACTED]');
  });
  it('audits HTTP 200 business errors as failures and redacts write-only fields', async () => {
    const audit = { log: jest.fn() };
    const request = { method: 'POST', path: '/api/v1/admin/test', headers: {}, user: { username: 'test' }, body: { channelConfig: { smtpPass: 'test-secret' } }, params: {}, query: {} };
    const context: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }), getHandler: () => function update() {}, getClass: () => ({ name: 'TestController' }) };
    await lastValueFrom(new AuditInterceptor(audit as any).intercept(context, { handle: () => of({ code: 1001, message: 'rejected' }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ result: 'failure', errorMessage: 'rejected' }));
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('test-secret');
  });
});

describe('Verified historical failure repair', () => {
  let service: any, task: any, body: any;
  beforeEach(() => {
    service = Object.create(TaskService.prototype);
    task = { taskId: 'test-task', status: TaskStatus.PENDING, provider: 'test', updatedAt: new Date('2026-05-01') };
    body = { confirmedFailure: true, reason: 'Provider support verified failed', verificationReference: 'support:test-only', expectedUpdatedAt: task.updatedAt.toISOString() };
    Object.assign(service, { taskRepo: { findByTaskId: async () => task, updateIfUnchanged: jest.fn().mockResolvedValue({ status: 'FAILED' }) }, billingService: { getRecord: jest.fn().mockResolvedValue({ status: 'pre_deducted' }) }, billingAdapter: { refund: jest.fn() }, timelineService: { addEvent: jest.fn() }, providerRegistry: { getAdapter: () => ({ queryTask: async () => ({ status: 'success' }) }) } });
  });
  it('requires explicit verification and rejects stale task versions', async () => {
    await expect(service.reconcileVerifiedFailure('test-task', { ...body, confirmedFailure: false }, 'test')).rejects.toThrow();
    await expect(service.reconcileVerifiedFailure('test-task', { ...body, expectedUpdatedAt: new Date().toISOString() }, 'test')).rejects.toThrow('变化');
    expect(service.billingAdapter.refund).not.toHaveBeenCalled();
  });
  it('refuses successful supplier tasks or already settled billing records', async () => {
    task.providerTask = { providerTaskId: 'test-job' };
    await expect(service.reconcileVerifiedFailure('test-task', body, 'test')).rejects.toThrow('拒绝修复');
    delete task.providerTask; service.billingService.getRecord.mockResolvedValue({ status: 'settled' });
    await expect(service.reconcileVerifiedFailure('test-task', body, 'test')).rejects.toThrow('已结算');
    expect(service.taskRepo.updateIfUnchanged).not.toHaveBeenCalled();
  });
  it('requires an atomic unchanged version before refunding a verified historical failure', async () => {
    service.taskRepo.updateIfUnchanged.mockResolvedValueOnce(null);
    await expect(service.reconcileVerifiedFailure('test-task', body, 'test')).rejects.toThrow('变化');
    expect(service.billingAdapter.refund).not.toHaveBeenCalled();
    await service.reconcileVerifiedFailure('test-task', body, 'test');
    expect(service.billingAdapter.refund).toHaveBeenCalledTimes(1);
  });
});
