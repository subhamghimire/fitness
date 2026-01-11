import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDatabaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { SyncModule } from './sync/sync.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({ imports: [ConfigModule], useFactory: getDatabaseConfig, inject: [ConfigService] }),
    AuthModule,
    SyncModule,
  ],
})
export class AppModule {}
