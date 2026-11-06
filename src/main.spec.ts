import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

describe('Application startup failure handling', () => {
  async function runStartup(failure?: Error, createFailure = false) {
    const error = jest.fn();
    const log = jest.fn();
    const exit = jest.fn();
    const app = {
      useBodyParser: jest.fn(), use: jest.fn(), enableCors: jest.fn(),
      useGlobalPipes: jest.fn(), useGlobalFilters: jest.fn(), useGlobalInterceptors: jest.fn(),
      get: () => ({ find: () => ({ lean: async () => [] }) }),
      listen: jest.fn(async () => { if (failure && !createFailure) throw failure; }),
    };
    class Logger { error = error; log = log; warn = jest.fn(); }
    class DocumentBuilder {
      setTitle() { return this; } setDescription() { return this; }
      setVersion() { return this; } addApiKey() { return this; }
      addBearerAuth() { return this; } build() { return {}; }
    }
    const imports: Record<string, unknown> = {
      '@nestjs/core': { NestFactory: { create: async () => { if (createFailure) throw failure; return app; } } },
      '@nestjs/common': { Logger, ValidationPipe: class {} },
      '@nestjs/swagger': { DocumentBuilder, SwaggerModule: { createDocument: () => ({}), setup: jest.fn() } },
      '@nestjs/mongoose': { getModelToken: () => 'model' },
      helmet: { default: () => jest.fn() },
      './app.module': { AppModule: class {} },
      './common/filters/global-exception.filter': { GlobalExceptionFilter: class {} },
      './common/interceptors/response-transform.interceptor': { ResponseTransformInterceptor: class {} },
      './database/schemas/model-config.schema': { ModelConfig: class {} },
      './common/utils/param-doc-generator': { generateSwaggerDescription: () => '' },
      './common/process-type.util': { resolveProcessType: () => 'api' },
    };
    const source = transpileModule(readFileSync(join(__dirname, 'main.ts'), 'utf8'), {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2021 },
    }).outputText;
    runInNewContext(source, {
      require: (name: string) => name in imports ? imports[name] : require(name),
      exports: {}, __dirname, Error, process: { env: {}, exit },
    });
    // Drain the async bootstrap and its rejection handler, without starting any server or DB.
    await new Promise<void>(resolve => setImmediate(resolve));
    return { app, error, log, exit };
  }

  it('exits when a database error interrupts module initialization during listen', async () => {
    const failure = new Error('MongoNetworkError: TLS connection closed');
    const result = await runStartup(failure);
    expect(result.app.listen).toHaveBeenCalledWith(3000);
    expect(result.error).toHaveBeenCalledWith(expect.stringContaining('Application startup failed'), failure.stack);
    expect(result.exit).toHaveBeenCalledWith(1);
    expect(result.log.mock.calls.flat().join(' ')).not.toContain('running on port');
  });

  it('also handles rejection before an application instance has been created', async () => {
    const result = await runStartup(new Error('database connection unavailable'), true);
    expect(result.app.listen).not.toHaveBeenCalled();
    expect(result.exit).toHaveBeenCalledWith(1);
  });

  it('keeps a successful application running', async () => {
    const result = await runStartup();
    expect(result.app.listen).toHaveBeenCalledWith(3000);
    expect(result.exit).not.toHaveBeenCalled();
    expect(result.error).not.toHaveBeenCalled();
    expect(result.log).toHaveBeenCalledWith('Model-Hub [api] running on port 3000');
  });
});
