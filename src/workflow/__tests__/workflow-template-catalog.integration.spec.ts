import { Test } from '@nestjs/testing';
import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { createConnection, Connection, Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowTemplate, WorkflowTemplateDocument, WorkflowTemplateSchema } from '../../database/schemas/workflow-template.schema';
import { Workflow, WorkflowDocument, WorkflowSchema } from '../../database/schemas/workflow.schema';
import { WorkflowTemplateService } from '../workflow-template.service';
import { WorkflowTemplateCatalogController } from '../workflow-template-catalog.controller';
import { WorkflowController } from '../workflow.controller';
import { WorkflowService } from '../workflow.service';
import { WorkflowPolicyService } from '../workflow-policy.service';
import { ExecutionGraphResolver } from '../execution-graph.resolver';
import { PortSchemaService } from '../port-schema.service';
import { ApiKeyOrJwtGuard } from '../../auth/guards/api-key-or-jwt.guard';
import { ResponseTransformInterceptor } from '../../common/interceptors/response-transform.interceptor';
import { CreateWorkflowTemplateDto } from '../dto/workflow-template.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('Workflow template discovery and adoption', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let templates: Model<WorkflowTemplate>;
  let workflows: Model<Workflow>;
  let app: INestApplication;
  let base: string;
  const definition = {
    name: 'Product flow', description: 'saved definition',
    nodes: [
      { id: 'input', type: 'input', position: { x: 0, y: 20 }, data: { label: 'Upload' } },
      { id: 'model', type: 'image-to-image', position: { x: 300, y: 20 }, data: { label: 'Replace background', modelId: 'image/model-v1', modelSelection: { configId: 'config-a', configRevision: 3, featureType: 'imageToImage', provider: 'provider-a' }, parameters: { prompt: 'studio', internal_token: 'never-public' } } },
      { id: 'output', type: 'output', position: { x: 600, y: 20 }, data: { label: 'Result' } },
    ],
    edges: [{ id: 'e1', source: { nodeId: 'input', port: 'image' }, target: { nodeId: 'model', port: 'image' }, label: 'original' }],
    viewport: { x: 10, y: 20, zoom: 1.25 },
    inputSchema: { image: { type: 'image', required: true, default: 'private-upload' } },
    outputMapping: { image: '$nodes.model.image' }, executionConfig: { timeout: 300 },
  };
  const policy = { assertCanCreate: jest.fn().mockResolvedValue(false), releaseWorkflowSlot: jest.fn() };
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, init);
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await createConnection(mongo.getUri()).asPromise();
    templates = connection.model(WorkflowTemplate.name, WorkflowTemplateSchema);
    workflows = connection.model(Workflow.name, WorkflowSchema);
    const templateService = new WorkflowTemplateService(templates as unknown as Model<WorkflowTemplateDocument>);
    const workflowService = new WorkflowService(workflows as unknown as Model<WorkflowDocument>, new EventEmitter2(), policy as unknown as WorkflowPolicyService);
    const module = await Test.createTestingModule({
      controllers: [WorkflowTemplateCatalogController, WorkflowController],
      providers: [
        { provide: WorkflowTemplateService, useValue: templateService },
        { provide: WorkflowService, useValue: workflowService },
        ExecutionGraphResolver, { provide: PortSchemaService, useValue: {} },
      ],
    }).overrideGuard(ApiKeyOrJwtGuard).useValue({ canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization !== 'Bearer test-user') return false;
      req.apiClient = { userId: 'test-user' }; return true;
    } }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  }, 60000);
  afterAll(async () => { await app?.close(); await connection?.close(); await mongo?.stop(); });
  beforeEach(async () => {
    policy.assertCanCreate.mockResolvedValue(false);
    await templates.deleteMany({}); await workflows.deleteMany({});
  });
  const seed = (extra = {}) => templates.create({ name: 'Product [studio]', category: 'Image', tags: ['product'], workflowDefinition: definition,
    isPublic: true, source: 'official', scenario: 'ecommerce', authorName: 'Model Hub', instructions: 'Upload a product photo', ...extra });

  it('lets guests browse published summaries and details without disclosing execution parameters or owners', async () => {
    const template = await seed({ creatorId: 'private-owner', examples: [{ title: 'Studio result', mediaType: 'image', outputUrl: 'https://cdn.test/result.png', inputUrl: 'https://cdn.test/input.png' }] });
    await seed({ name: 'Hidden draft', isPublic: false });
    const list = await request('/v1/catalog/workflow-templates');
    expect(list.status).toBe(200); expect(list.body.data.total).toBe(1);
    expect(list.body.data.items[0]).toMatchObject({ id: String(template._id), nodeCount: 3, models: ['image/model-v1'], source: 'official' });
    const result = await request(`/v1/catalog/workflow-templates/${template._id}`);
    expect(result.status).toBe(200);
    expect(result.body.data.graph.edges[0]).toEqual({ id: 'e1', source: 'input', target: 'model', label: 'original' });
    expect(result.body.data.examples[0].outputUrl).toBe('https://cdn.test/result.png');
    expect(result.body.data.inputs).toEqual([{ name: 'image', type: 'image', required: true }]);
    for (const text of ['never-public', 'private-upload', 'private-owner', 'parameters', 'workflowDefinition', 'config-a']) expect(JSON.stringify(result.body)).not.toContain(text);
  });

  it('combines source, scenario and literal keyword search and paginates stable results', async () => {
    await seed(); await seed({ name: 'Another [studio]' });
    await seed({ name: 'Community [studio]', source: 'community' });
    await seed({ name: 'Video [studio]', category: 'Video', scenario: 'video' });
    const result = await request('/v1/catalog/workflow-templates?source=official&scenario=ecommerce&search=%5Bstudio%5D&pageSize=1&order=name');
    expect(result.status).toBe(200); expect(result.body.data.total).toBe(2);
    expect(result.body.data.items[0].name).toBe('Another [studio]');
    const second = await request('/v1/catalog/workflow-templates?source=official&scenario=ecommerce&search=%5Bstudio%5D&pageSize=1&page=2&order=name');
    expect(second.body.data.items[0].name).toBe('Product [studio]');
    const modelSearch = await request('/v1/catalog/workflow-templates?source=community&search=image%2Fmodel');
    expect(modelSearch.body.data.total).toBe(1);
  });

  it('keeps existing platform-managed templates discoverable without a source migration', async () => {
    await templates.collection.insertOne({ name: 'Legacy official', category: 'Image', isPublic: true, workflowDefinition: definition } as any);
    const result = await request('/v1/catalog/workflow-templates?source=official');
    expect(result.body.data.total).toBe(1); expect(result.body.data.items[0].source).toBe('official');
  });

  it('returns 404 for unpublished, removed and malformed template links', async () => {
    const draft = await seed({ isPublic: false });
    for (const id of [String(draft._id), '000000000000000000000000', 'invalid']) {
      expect((await request(`/v1/catalog/workflow-templates/${id}`)).status).toBe(404);
    }
  });

  it.each(['page=0', 'page=Infinity', 'pageSize=49', 'source=unknown', 'order=popular', 'search[$ne]=x'])('rejects malformed discovery filters: %s', async query => {
    expect((await request(`/v1/catalog/workflow-templates?${query}`)).status).toBe(400);
  });

  it('copies the complete definition into a new owned workflow without starting execution', async () => {
    const template = await seed();
    const path = `/v1/workflows/from-template/${template._id}`;
    expect((await request(path, { method: 'POST' })).status).toBe(403);
    const result = await request(path, { method: 'POST', headers: { Authorization: 'Bearer test-user' } });
    expect(result.status).toBe(201);
    const copy = await workflows.findById(result.body.data._id).lean();
    expect(copy).toMatchObject({ creatorId: 'test-user', status: 'draft', nodes: definition.nodes, edges: definition.edges,
      viewport: definition.viewport, inputSchema: definition.inputSchema, outputMapping: definition.outputMapping, executionConfig: definition.executionConfig });
    expect((await templates.findById(template._id))?.workflowDefinition).toEqual(definition);
    await workflows.updateOne({ _id: copy!._id }, { name: 'My edit' });
    expect((await templates.findById(template._id))?.name).toBe('Product [studio]');
  });

  it('preserves quota checks and cannot copy a withdrawn template', async () => {
    const template = await seed();
    policy.assertCanCreate.mockRejectedValueOnce(new ForbiddenException('Workflow quota reached'));
    const options = { method: 'POST', headers: { Authorization: 'Bearer test-user' } };
    expect((await request(`/v1/workflows/from-template/${template._id}`, options)).status).toBe(403);
    expect(await workflows.countDocuments()).toBe(0);
    await templates.updateOne({ _id: template._id }, { isPublic: false });
    expect((await request(`/v1/workflows/from-template/${template._id}`, options)).status).toBe(404);
  });

  it('validates publication metadata and nested workflow definitions', async () => {
    const dto = plainToInstance(CreateWorkflowTemplateDto, { name: 'Example', category: 'Image', workflowDefinition: { nodes: definition.nodes, edges: [] }, examples: [{ title: 'Result', mediaType: 'image', outputUrl: 'javascript:alert(1)' }] });
    expect(await validate(dto)).not.toHaveLength(0);
    dto.examples = [];
    expect(await validate(dto)).toHaveLength(0);
    dto.workflowDefinition = {} as any;
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
