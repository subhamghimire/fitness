import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreateInvitationDto {
  @ApiProperty({ description: "UUID of the user to invite as a client" })
  @IsUUID()
  clientId: string;
}
