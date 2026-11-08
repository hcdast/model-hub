import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowRunController } from './workflow-run.controller';
import { WorkflowTemplateController } from './workflow-template.controller';
import { WorkflowTemplateCatalogController } from './workflow-template-catalog.controller';
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
import { WorkflowAsset, WorkflowAssetSchema } from '../database/schemas/workflow-asset.schema';
import { WorkflowAssetController } from './workflow-asset.controller';
import { WorkflowAssetService } from './workflow-asset.service';
import { S3WorkflowAssetStorageService } from './s3-workflow-asset-storage.service';
import { LinkConversionConfigModule } from '../admin/link-conversion-config.module';
import { ShortDramaProject, ShortDramaProjectSchema, ShortDramaCandidate, ShortDramaCandidateSchema, ShortDramaQuote, ShortDramaQuoteSchema } from '../short-drama/drama.schema';
import { ShortDramaService } from '../short-drama/drama.service';
import { ShortDramaRenderService } from '../short-drama/drama-render.service';
import { ShortDramaController } from '../short-drama/drama.controller';
import { DramaTemplateCatalogController } from '../short-drama/drama-template-catalog.controller';
import { ModelConfig, ModelConfigSchema } from '../database/schemas/model-config.schema';
import { ProviderModule } from '../provider/provider.module';
import { CreationTemplateSubmission, CreationTemplateSubmissionSchema } from '../creation/creation-template.schema';
import { CreationTemplateService } from '../creation/creation-template.service';
import { CreationTemplateController } from '../creation/creation-template.controller';
import { DramaWorkflowLink, DramaWorkflowLinkSchema } from '../creation/drama-workflow.schema';
import { DramaWorkflowService } from '../creation/drama-workflow.service';
import { DramaWorkflowController } from '../creation/drama-workflow.controller';
import { TemplateInsightsService } from '../creation/template-insights.service';
import { WorkflowBudgetService } from '../creation/workflow-budget.service';
import { WorkflowBudgetTask, WorkflowBudgetTaskSchema } from '../creation/workflow-budget.schema';
import { BillingRecord, BillingRecordSchema } from '../database/schemas/billing-record.schema';
import { Task, TaskSchema } from '../database/schemas/task.schema';
import { CreationEvent, CreationEventSchema } from '../creation/creation-event.schema';
import { CreationEventService } from '../creation/creation-event.service';
import { CreationEventController } from '../creation/creation-event.controller';

/**
 * Workflow 模块
 * 提供工作流定义的 CRUD 功能和执行调度
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CreationEvent.name, schema: CreationEventSchema },
      { name: WorkflowBudgetTask.name, schema: WorkflowBudgetTaskSchema },
      { name: BillingRecord.name, schema: BillingRecordSchema },
      { name: Task.name, schema: TaskSchema },
      { name: CreationTemplateSubmission.name, schema: CreationTemplateSubmissionSchema },
      { name: DramaWorkflowLink.name, schema: DramaWorkflowLinkSchema },
      { name: Workflow.name, schema: WorkflowSchema },
      { name: WorkflowRun.name, schema: WorkflowRunSchema },
      { name: WorkflowTemplate.name, schema: WorkflowTemplateSchema },
      { name: PortalUser.name, schema: PortalUserSchema },
      { name: WorkflowAsset.name, schema: WorkflowAssetSchema },
      { name: ShortDramaProject.name, schema: ShortDramaProjectSchema },
      { name: ShortDramaCandidate.name, schema: ShortDramaCandidateSchema },
      { name: ShortDramaQuote.name, schema: ShortDramaQuoteSchema },
      { name: ModelConfig.name, schema: ModelConfigSchema },
    ]),
    BullModule.registerQueue({
      name: 'workflow-node',
    }, { name: 'short-drama-render' }),
    ApiClientModule,
    AuthModule,
    TaskModule,
    LinkConversionConfigModule,
    ProviderModule,
  ],
  controllers: [CreationEventController, CreationTemplateController, DramaWorkflowController, WorkflowController, WorkflowRunController, WorkflowTemplateController, WorkflowTemplateCatalogController, WorkflowAssetController, ShortDramaController, DramaTemplateCatalogController],
  providers: [
    CreationEventService,
    WorkflowBudgetService,
    TemplateInsightsService,
    CreationTemplateService, DramaWorkflowService,
    ShortDramaService,
    ShortDramaRenderService,
    WorkflowAssetService,
    S3WorkflowAssetStorageService,
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
    CreationEventService,
    TemplateInsightsService,
    CreationTemplateService,
    WorkflowService,
    ExecutionGraphResolver,
    PortSchemaService,
    WorkflowExecutionService,
    WorkflowTemplateService,
  ],
})
export class WorkflowModule {}
