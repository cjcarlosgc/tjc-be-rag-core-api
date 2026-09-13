import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

async function bootstrap() {
  // rawBody: true conserva el body crudo (req.rawBody) para verificar la
  // firma x-hub-signature-256 de los webhooks de GitHub sobre bytes exactos,
  // no sobre una re-serialización del JSON ya parseado.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors();

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
