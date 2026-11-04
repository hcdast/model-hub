import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowExecutionService } from '../workflow-execution.service';
import { ExecutionGraphResolver } from '../execution-graph.resolver';
import { ErrorCode } from '../../common/constants/error-codes';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { needsWorkflowApiKey, workflowReturnPath } from '../../../portal/src/utils/workflow-billing';

describe('Workflow missing billing key recovery', () => {
  const harness = (model = true) => {
    const workflow = { _id: 'flow', creatorId: 'owner', nodes: [{ id: 'node', type: model ? 'model' : 'input', data: model ? { modelId: 'test-model' } : {} }], edges: [] };
    const runs = jest.fn() as jest.Mock & Model<any>;
    const billing = { findExecutionBillingKey: jest.fn().mockResolvedValue(null) };
    const policy = { assertNodesAllowed: jest.fn(), acquireRun: jest.fn().mockRejectedValue(new Error('lease reached')) };
    const queue = { add: jest.fn() };
    const service = new WorkflowExecutionService(runs, { findOne: jest.fn().mockResolvedValue(workflow) } as never, queue as never,
      new ExecutionGraphResolver(), new EventEmitter2(), billing as never, {} as never, policy as never);
    return { service, runs, billing, policy, queue };
  };

  it('returns a stable HTTP business code and never starts a run when no billing key exists', async () => {
    const { service, runs, policy, queue } = harness();
    const error = await service.run('flow', {}, 'owner').catch(error => error);
    expect(error.getStatus()).toBe(400);
    expect(error.errorCode).toBe(ErrorCode.WORKFLOW_API_KEY_REQUIRED);
    expect(runs).not.toHaveBeenCalled();
    expect(policy.acquireRun).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    new GlobalExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ method: 'POST', url: '/v1/workflows/flow/run', path: '/v1/workflows/flow/run' }) }) } as never);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 1009 }));
  });

  it('uses an existing user key, preserves explicit authenticated API keys and allows non-model workflows', async () => {
    const found = harness(); found.billing.findExecutionBillingKey.mockResolvedValue('portal:existing' as never);
    await expect(found.service.run('flow', {}, 'owner')).rejects.toThrow('lease reached');
    const explicit = harness();
    await expect(explicit.service.run('flow', {}, 'owner', undefined, 'authenticated-client-key')).rejects.toThrow('lease reached');
    expect(explicit.billing.findExecutionBillingKey).not.toHaveBeenCalled();
    const free = harness(false);
    await expect(free.service.run('flow', {}, 'owner')).rejects.toThrow('lease reached');
    expect(free.billing.findExecutionBillingKey).not.toHaveBeenCalled();
  });

  it('recognizes only billing-key errors and restricts the return link to saved workflow pages', () => {
    const error = (status: number, data: unknown) => ({ isAxiosError: true, response: { status, data } });
    expect(needsWorkflowApiKey(error(400, { code: 1009 }))).toBe(true);
    expect(needsWorkflowApiKey(error(400, { code: 1001, message: 'Create an enabled Portal API Key before running model nodes' }))).toBe(true);
    for (const value of [error(400, { code: 1001, message: 'invalid input' }), error(401, { code: 1009 }), new Error('network')]) expect(needsWorkflowApiKey(value)).toBe(false);
    expect(workflowReturnPath('/workflows/6ae0097b02543d92fe755b88')).toBe('/workflows/6ae0097b02543d92fe755b88');
    for (const path of [null, '//example.com', 'https://example.com', '/workflows/new', '/workflows/123?run=1']) expect(workflowReturnPath(path)).toBeNull();
  });
});
