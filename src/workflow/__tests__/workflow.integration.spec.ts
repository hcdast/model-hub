/*
 * 工作流集成测试
 * 测试完整的执行流程
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WorkflowService } from '../workflow.service';
import { WorkflowExecutionService } from '../workflow-execution.service';
import { ExecutionGraphResolver } from '../execution-graph.resolver';
import { WorkflowPolicyService } from '../workflow-policy.service';
import { PortalApiKeyService } from '../../portal-auth/portal-api-key.service';
import { TaskService } from '../../task/task.service';
import { getQueueToken } from '@nestjs/bull';
import { Workflow, WorkflowSchema } from '../../database/schemas/workflow.schema';
import { WorkflowRun, WorkflowRunSchema } from '../../database/schemas/workflow-run.schema';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, connect, Model } from 'mongoose';

describe('Workflow Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let mongoConnection: Connection;
  let workflowService: WorkflowService;
  let executionService: WorkflowExecutionService;
  let workflowModel: Model<Workflow>;
  let runModel: Model<WorkflowRun>;

  let moduleRef: TestingModule;
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();

    mongoConnection = (await connect(uri)).connection;

    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        MongooseModule.forRootAsync({
          useFactory: () => ({ uri }),
        }),
        MongooseModule.forFeature([
          { name: Workflow.name, schema: WorkflowSchema },
          { name: WorkflowRun.name, schema: WorkflowRunSchema },
        ]),
      ],
      providers: [
        WorkflowService,
        WorkflowExecutionService,
        ExecutionGraphResolver,
        {
          provide: WorkflowPolicyService,
          useValue: {
            assertCanCreate: jest.fn(),
            assertNodesAllowed: jest.fn(),
            acquireRun: jest.fn().mockResolvedValue({
              timeoutSeconds: 300,
              acquired: false,
            }),
            releaseWorkflowSlot: jest.fn(),
            releaseRun: jest.fn(),
          },
        },
        {
          provide: getQueueToken('workflow-node'),
          useValue: {
            add: jest.fn(),
            getJobs: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PortalApiKeyService,
          useValue: { findExecutionBillingKey: jest.fn() },
        },
        {
          provide: TaskService,
          useValue: { cancelTask: jest.fn() },
        },
      ],
    }).compile();

    workflowService = moduleRef.get<WorkflowService>(WorkflowService);
    executionService = moduleRef.get<WorkflowExecutionService>(WorkflowExecutionService);
    workflowModel = moduleRef.get<Model<Workflow>>(`${Workflow.name}Model`);
    runModel = moduleRef.get<Model<WorkflowRun>>(`${WorkflowRun.name}Model`);
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
    if (mongoConnection) {
      await mongoConnection.close();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  afterEach(async () => {
    await workflowModel.deleteMany({});
    await runModel.deleteMany({});
  });

  describe('完整工作流执行流程', () => {
    it('应成功创建、执行、查询和取消工作流', async () => {
      // 1. 创建工作流
      const workflow = await workflowService.create(
        {
          name: '集成测试工作流',
          nodes: [
            { id: 'input-1', type: 'input', position: { x: 0, y: 0 }, data: {} },
            { id: 'output-1', type: 'output', position: { x: 200, y: 0 }, data: {} },
          ],
          edges: [],
        },
        'test-client',
      );

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe('集成测试工作流');
      expect(workflow.nodes).toHaveLength(2);

      // 2. 触发执行
      const runResult = await executionService.run(
        workflow._id.toString(),
        { test: 'input' },
        'test-client',
      );

      expect(runResult.runId).toBeDefined();
      expect(runResult.status).toBe('running');

      // 3. 查询执行状态
      const runStatus = await executionService.getStatus(
        runResult.runId,
        'test-client',
      );
      expect(runStatus).toBeDefined();
      expect(runStatus?.status).toBe('running');

      // 4. 取消执行
      await executionService.cancel(runResult.runId, 'test-client');

      const cancelledStatus = await executionService.getStatus(
        runResult.runId,
        'test-client',
      );
      expect(cancelledStatus?.status).toBe('cancelled');
    });

    it('应正确处理包含多节点的工作流', async () => {
      // 创建包含模型节点的工作流
      const workflow = await workflowService.create(
        {
          name: '多节点工作流',
          nodes: [
            { id: 'input-1', type: 'input', position: { x: 0, y: 0 }, data: {} },
            {
              id: 'model-1',
              type: 'model',
              position: { x: 200, y: 0 },
              data: { modelId: 'test-model' },
            },
            { id: 'output-1', type: 'output', position: { x: 400, y: 0 }, data: {} },
          ],
          edges: [
            {
              id: 'e1',
              source: { nodeId: 'input-1', port: 'output' },
              target: { nodeId: 'model-1', port: 'input' },
            },
            {
              id: 'e2',
              source: { nodeId: 'model-1', port: 'output' },
              target: { nodeId: 'output-1', port: 'input' },
            },
          ],
        },
        'test-client',
      );

      expect(workflow.nodes).toHaveLength(3);
      expect(workflow.edges).toHaveLength(2);
    });

    it('应支持工作流的更新和删除', async () => {
      // 创建工作流
      const workflow = await workflowService.create(
        {
          name: '待更新工作流',
          nodes: [{ id: 'node-1', type: 'input', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        },
        'test-client',
      );

      // 更新工作流
      const updated = await workflowService.update(
        workflow._id.toString(),
        {
          name: '已更新工作流',
          status: 'active',
        },
        'test-client',
      );

      expect(updated.name).toBe('已更新工作流');
      expect(updated.status).toBe('active');

      // 删除工作流
      await workflowService.delete(workflow._id.toString(), 'test-client');

      const deleted = await workflowService.findById(
        workflow._id.toString(),
        'test-client',
      );
      expect(deleted).toBeNull();
    });

    it('应支持分页查询工作流列表', async () => {
      // 创建多个工作流
      for (let i = 0; i < 5; i++) {
        await workflowService.create(
          {
            name: `工作流 ${i}`,
            nodes: [{ id: 'node-1', type: 'input', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
          },
          'test-client',
        );
      }

      // 分页查询
      const result = await workflowService.list({
        page: 1,
        pageSize: 3,
        creatorId: 'test-client',
      });

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(5);
    });

    it('并发节点完成时不丢失其他节点终态', async () => {
      const workflow = await workflowService.create(
        {
          name: '并发完成工作流',
          nodes: [
            { id: 'node-a', type: 'input', position: { x: 0, y: 0 }, data: {} },
            { id: 'node-b', type: 'input', position: { x: 1, y: 0 }, data: {} },
          ],
          edges: [],
        },
        'test-client',
      );
      await runModel.create({
        runId: 'parallel-complete-run',
        workflowId: workflow._id.toString(),
        workflowVersion: workflow.__v ?? 0,
        triggerId: 'test-client',
        parentTaskId: 'workflow:parallel-complete-run',
        status: 'running',
        startedAt: new Date(),
        nodeStates: [
          { nodeId: 'node-a', status: 'running', retryCount: 0, attempt: 0 },
          { nodeId: 'node-b', status: 'running', retryCount: 0, attempt: 0 },
        ],
      });

      await Promise.all([
        executionService.onNodeComplete('parallel-complete-run', 'node-a', {
          value: 'a',
        }),
        executionService.onNodeComplete('parallel-complete-run', 'node-b', {
          value: 'b',
        }),
      ]);

      const run = await runModel.findOne({ runId: 'parallel-complete-run' });
      expect(run?.status).toBe('succeeded');
      expect(run?.nodeStates.map((state) => state.status)).toEqual([
        'succeeded',
        'succeeded',
      ]);
    });
  });
});
