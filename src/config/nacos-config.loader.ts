import { Logger } from '@nestjs/common';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: resolve(process.cwd(), '.env') });

const logger = new Logger('NacosConfigLoader');

/**
 * 与 Akool 现有服务（open-api / AGI-Content / faceswap）对齐：
 * - NACOS_ENABLE=true → 整包从 Nacos 拉取 JSON，作为唯一配置来源
 * - NACOS_ENABLE=false → 读本地 config/${NODE_ENV}.json
 *
 * 注：PM2 通过 ecosystem.config.js 启动时不读 .env 文件，
 * 所以在此处主动加载 .env 确保 NACOS_* 变量可用。
 */
export async function loadAppConfig(): Promise<Record<string, any>> {
  const nacosEnabled = ['true', '1', 'yes'].includes(
    (process.env.NACOS_ENABLE || '').toLowerCase(),
  );

  if (nacosEnabled) {
    return loadFromNacos();
  }

  return loadFromLocal();
}

async function loadFromNacos(): Promise<Record<string, any>> {
  const serverAddr = process.env.NACOS_SERVER_ADDR;
  if (!serverAddr) {
    throw new Error('NACOS_ENABLE=true but NACOS_SERVER_ADDR is empty');
  }

  const namespace = process.env.NACOS_NAMESPACE || undefined;
  const dataId = process.env.NACOS_DATA_ID || 'model-hub';
  const group = process.env.NACOS_GROUP || 'DEFAULT_GROUP';

  logger.log(
    `Reading config from Nacos: addr=${serverAddr} namespace=${namespace} dataId=${dataId} group=${group}`,
  );

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NacosConfigClient } = require('nacos');

  const client = new NacosConfigClient({
    serverAddr,
    namespace,
    username: process.env.NACOS_USERNAME || undefined,
    password: process.env.NACOS_PASSWORD || undefined,
  });

  await client.ready();

  const content = await client.getConfig(dataId, group);
  if (!content) {
    throw new Error(`Nacos config empty for dataId=${dataId}, group=${group}`);
  }

  const config = JSON.parse(content);
  logger.log(`Loaded config from Nacos (dataId=${dataId}), keys: ${Object.keys(config).join(', ')}`);

  client.subscribe({ dataId, group }, (newContent: string) => {
    logger.log(`Nacos config changed (dataId=${dataId}), restart to apply connection-level changes`);
  });

  return config;
}

function loadFromLocal(): Record<string, any> {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const configPath = resolve(process.cwd(), `config/${nodeEnv}.json`);

  if (!existsSync(configPath)) {
    throw new Error(`Local config not found: ${configPath}`);
  }

  logger.log(`Reading config from local file: ${configPath}`);
  const content = readFileSync(configPath, 'utf-8');
  return JSON.parse(content);
}
