import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";

export const paramIdPipe = (label: string): ParseUUIDPipe =>
  new ParseUUIDPipe({
    // version: "4",
    // errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(`Invalid [${label}] in params.`)
  });
