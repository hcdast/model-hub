import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'path';
import { existsSync } from 'fs';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { ModelConfig, ModelConfigDocument } from './database/schemas/model-config.schema';
import { generateSwaggerDescription } from './common/utils/param-doc-generator';
import { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const processType = process.env.PROCESS_TYPE || 'api';
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');
  const port = parseInt(process.env.PORT || '3000', 10);

  /**
   * 管理端托管 Dashboard SPA：刷新 /models、/model-routing-rules 等深链时必须返回 index.html。
   * 须挂在中间件栈最前，否则会先落到 Nest 404（Cannot GET /xxx）。
   */
  if (processType === 'admin-server') {
    const indexHtml = join(__dirname, '..', 'dashboard', 'dist', 'index.html');
    if (!existsSync(indexHtml)) {
      logger.warn(`Dashboard index.html 不存在: ${indexHtml}，请先执行 npm run build:dashboard`);
    }
    app.getHttpAdapter().getInstance().use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const p = req.path || '';
      if (p.startsWith('/api') || p.startsWith('/apidoc') || p.startsWith('/health')) return next();
      if (/\.[a-zA-Z0-9]+$/.test(p)) return next();
      if (!existsSync(indexHtml)) return next();
      res.sendFile(indexHtml, (err) => (err ? next(err) : undefined));
    });
  }

  const helmetMiddleware = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/apidoc')) {
      return next();
    }
    return helmetMiddleware(req, res, next);
  });
  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseTransformInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Model-Hub API')
    .setDescription('Akool 统一 AI 模型接入中台 — 接口文档')
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      'ApiKey',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'AdminJwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // 动态注入模型参数文档到 POST /v1/tasks 的 Swagger description
  try {
    const modelConfigModel = app.get<Model<ModelConfigDocument>>(
      getModelToken(ModelConfig.name),
    );
    const allConfigs = await modelConfigModel
      .find({ disabled: { $ne: true } })
      .lean<ModelConfig[]>();
    const paramDocs = generateSwaggerDescription(allConfigs);
    if (paramDocs && document.paths?.['/v1/tasks']?.post) {
      const existing = document.paths['/v1/tasks'].post.description || '';
      document.paths['/v1/tasks'].post.description = existing + '\n\n' + paramDocs;
    }
  } catch (err) {
    logger.warn('Failed to inject model param docs into Swagger: ' + (err as Error).message);
  }

  SwaggerModule.setup('apidoc', app, document, {
    customSiteTitle: 'Model-Hub API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
    },
  });

  await app.listen(port);
  logger.log(`Model-Hub [${processType}] running on port ${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/apidoc`);
}

bootstrap();
