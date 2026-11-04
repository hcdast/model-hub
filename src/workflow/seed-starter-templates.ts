import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createConnection } from 'mongoose';
import { loadAppConfig } from '../config/nacos-config.loader';
import { buildStarterTemplates } from './starter-templates';
import { ModelConfig } from '../database/schemas/model-config.schema';
import { ExecutionGraphResolver } from './execution-graph.resolver';
import { Workflow } from '../database/schemas/workflow.schema';

async function main() {
  Logger.overrideLogger(['error']);
  const apply = process.argv.includes('--apply');
  const config = await loadAppConfig();
  const connection = await createConnection(config.mongodb.uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const models = await connection.db!.collection('model_configs').find({ disabled: { $ne: true } }, {
      projection: { model_id: 1, model_type: 1, model_name: 1, provider: 1, revision: 1, params: 1, params_rules: 1 },
    }).toArray();
    const { templates, skipped } = buildStarterTemplates(models as unknown as Array<ModelConfig & { _id: unknown }>);
    const resolver = new ExecutionGraphResolver();
    for (const template of templates) {
      const result = resolver.validate(template.workflowDefinition as Workflow);
      if (!result.valid) throw new Error(`Invalid starter workflow: ${template.name}`);
    }
    const collection = connection.db!.collection('workflow_templates');
    const existing = await collection.countDocuments({ _id: { $in: templates.map(item => item._id) } });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', availableModels: models.length, ready: templates.length, existing, skipped, names: templates.map(item => item.name) }));
    if (apply && templates.length) {
      const now = new Date();
      const result = await collection.bulkWrite(templates.map(template => ({ updateOne: {
        filter: { _id: template._id }, update: { $setOnInsert: { ...template, createdAt: now, updatedAt: now } }, upsert: true,
      } })));
      console.log(JSON.stringify({ inserted: result.upsertedCount, preserved: result.matchedCount }));
    }
  } finally { await connection.close(); }
}

if (require.main === module) main().catch(() => {
  // Connection errors can contain credentials: do not dump configuration or raw errors.
  console.error('官方模板初始化失败，请检查数据库连接、模型配置及上方校验信息。');
  process.exitCode = 1;
});
