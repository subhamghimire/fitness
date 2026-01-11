import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { typOrmConfig } from "typeOrm.config";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => typOrmConfig
    })
  ]
})
export class DbModule {}
