import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function main() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  if (process.env.CORS_ORIGIN) app.enableCors({ origin: process.env.CORS_ORIGIN });
  await app.listen(Number(process.env.PORT ?? 3000));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
