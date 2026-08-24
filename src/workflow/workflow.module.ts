import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowRunController } from './workflow-run.controller';
import { WorkflowTemplateController } from './workflow-template.controller';
import { ExecutionGraphResolver } from './execution-graph.resolver';
import { PortSchemaService } from './port-schema.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { NodeExecutor } from './node.executor';
import { WorkflowTemplateService } from './workflow-template.service';
import { SafeExpressionService } from './safe-expression.service';
import { WorkflowPolicyService } from './workflow-policy.service';
import { Workflow, WorkflowSchema } from '../database/schemas/workflow.schema';
import { WorkflowRun, WorkflowRunSchema } from '../database/schemas/workflow-run.schema';
import { WorkflowTemplate, WorkflowTemplateSchema } from '../database/schemas/workflow-template.schema';
import { PortalUser, PortalUserSchema } from '../database/schemas/portal-user.schema';
import { ApiClientModule } from '../api-client/api-client.module';
import { AuthModule } from '../auth/auth.module';
import { TaskModule } from '../task/task.module';

/**
 * Workflow 模块
 * 提供工作流定义的 CRUD 功能和执行调度
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workflow.name, schema: WorkflowSchema },
      { name: WorkflowRun.name, schema: WorkflowRunSchema },
      { name: WorkflowTemplate.name, schema: WorkflowTemplateSchema },
      { name: PortalUser.name, schema: PortalUserSchema },
    ]),
    BullModule.registerQueue({
      name: 'workflow-node',
    }),
    ApiClientModule,
    AuthModule,
    TaskModule,
  ],
  controllers: [WorkflowController, WorkflowRunController, WorkflowTemplateController],
  providers: [
    WorkflowService,
    ExecutionGraphResolver,
    PortSchemaService,
    WorkflowExecutionService,
    NodeExecutor,
    SafeExpressionService,
    WorkflowPolicyService,
    WorkflowTemplateService,
  ],
  exports: [
    WorkflowService,
    ExecutionGraphResolver,
    PortSchemaService,
    WorkflowExecutionService,
    WorkflowTemplateService,
  ],
})
export class WorkflowModule {}
