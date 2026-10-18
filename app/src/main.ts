import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { createConsoleCorsOrigin } from './common/cors.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { registerProcessSafetyNets } from './common/process-safety.js';
import { configureRequestBodyParsers } from './request-body-parsers.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);

  // SIGTERM/SIGINT ejecutan onModuleDestroy (poller de jobs, barridos) en lugar de cortar en seco.
  app.enableShutdownHooks();
  registerProcessSafetyNets(new Logger('Process'), async (exitCode) => {
    await app.close().catch(() => undefined);
    process.exit(exitCode);
  });

  app.enableCors({ origin: createConsoleCorsOrigin() });
  configureRequestBodyParsers(
    app.getHttpAdapter().getInstance(),
    config.get<string>('GITHUB_INTEGRATION_TO_CORE_TOKEN') ?? '',
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
