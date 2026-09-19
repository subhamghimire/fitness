import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CoachClientRelationship } from "./entities/coach-client-relationship.entity";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { RelationshipStatus } from "./enums";
import {
  CreateInvitationDto,
  UpdateRelationshipStatusDto,
  CoachClientQueryDto,
  CoachClientRelationshipResponseDto,
  ClientInvitationResponseDto,
  ClientCoachResponseDto,
  CoachClientProgressResponseDto
} from "./dto";
import { OverviewQueryDto } from "src/modules/progress/dto/progress-query.dto";
import { ProgressService } from "src/modules/progress/progress.service";

/**
 * Determines which status transitions a coach may trigger. A client can only
 * accept (PENDING -> ACTIVE) or reject (PENDING -> ENDED) an invitation.
 * Terminal states are never revisited: once ENDED/BLOCKED the row is frozen and
 * a new relationship row must be created for the pair.
 */
const COACH_TRANSITIONS: Partial<Record<RelationshipStatus, RelationshipStatus[]>> = {
  [RelationshipStatus.ACTIVE]: [RelationshipStatus.PAUSED], // resume a paused relationship
  [RelationshipStatus.PAUSED]: [RelationshipStatus.ACTIVE],
  [RelationshipStatus.ENDED]: [RelationshipStatus.PENDING, RelationshipStatus.ACTIVE, RelationshipStatus.PAUSED],
  [RelationshipStatus.BLOCKED]: [RelationshipStatus.PENDING, RelationshipStatus.ACTIVE, RelationshipStatus.PAUSED]
};

@Injectable()
export class CoachClientRelationshipService {
  constructor(
    @InjectRepository(CoachClientRelationship)
    private readonly relationshipRepo: Repository<CoachClientRelationship>,
    @InjectRepository(Coach)
    private readonly coachRepo: Repository<Coach>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly progressService: ProgressService
  ) {}

  // ─── Coach flow ──────────────────────────────────────────────────────────

  /**
   * Coach invites a client. Creates a PENDING relationship. An invitation is
   * rejected if the pair already has a live relationship (pending/active/paid).
   */
  async invite(user: User, dto: CreateInvitationDto): Promise<CoachClientRelationshipResponseDto> {
    const coach = await this.requireCoach(user);

    const client = await this.userRepo.findOne({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException(`Client with ID "${dto.clientId}" not found`);
    if (client.id === coach.userId) throw new BadRequestException("You cannot invite yourself as a client");

    const existing = await this.relationshipRepo.findOne({
      where: { coachId: coach.id, clientId: dto.clientId }
    });
    if (existing && ![RelationshipStatus.ENDED, RelationshipStatus.BLOCKED].includes(existing.status)) {
      throw new ConflictException("This pair already has a live relationship");
    }

    const relationship = this.relationshipRepo.create({
      coachId: coach.id,
      clientId: dto.clientId,
      status: RelationshipStatus.PENDING
    });

    try {
      const saved = await this.relationshipRepo.save(relationship);
      return await this.toResponseDto(saved.id);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException("This pair already has a live relationship");
      }
      throw err;
    }
  }

  /**
   * Coach lists their own relationships (optionally filtered by status).
   * Always scoped to the coach — Coach A can never see Coach B's clients.
   */
  async findForCoach(user: User, query: CoachClientQueryDto): Promise<CoachClientRelationshipResponseDto[]> {
    const coach = await this.requireCoach(user);
    const where: Record<string, unknown> = { coachId: coach.id, isDeleted: false };
    if (query.status) where.status = query.status;
    const relationships = await this.relationshipRepo.find({
      where,
      relations: { coach: true, client: true },
      order: { createdAt: "DESC" }
    });
    return relationships.map((r) => this.buildRelationshipDto(r));
  }

  async findForActor(user: User, id: string): Promise<CoachClientRelationshipResponseDto> {
    const relationship = await this.loadOwnedBy(user, id);
    return this.buildRelationshipDto(relationship);
  }

  /**
   * Coach manages the lifecycle of their relationship: pause / resume / end /
   * block. Terminal states preserve history — `endedAt` is stamped and the row
   * is never overwritten afterwards.
   */
  async updateStatus(user: User, id: string, dto: UpdateRelationshipStatusDto): Promise<CoachClientRelationshipResponseDto> {
    const relationship = await this.loadOwnedBy(user, id);
    const target = dto.status;

    if (relationship.status === target) return this.buildRelationshipDto(relationship);

    const allowedFrom = COACH_TRANSITIONS[target];
    if (!allowedFrom || !allowedFrom.includes(relationship.status)) {
      throw new BadRequestException(`Cannot transition relationship from "${relationship.status}" to "${target}"`);
    }

    this.applyTransition(relationship, target);
    const saved = await this.relationshipRepo.save(relationship);
    return this.buildRelationshipDto(saved);
  }

  /**
   * Coach (or the client themselves) views progress rooted in relationship
   * ownership: only the assigned coach or the client may read it. `loadOwnedBy`
   * already guarantees the actor participates in the relationship.
   */
  async viewProgress(user: User, id: string, query: OverviewQueryDto): Promise<CoachClientProgressResponseDto> {
    const relationship = await this.loadOwnedBy(user, id);
    const overview = await this.progressService.overview(relationship.clientId, query);
    return {
      relationshipId: relationship.id,
      clientId: relationship.clientId,
      overview
    };
  }

  // ─── Client flow ─────────────────────────────────────────────────────────

  async accept(user: User, id: string): Promise<CoachClientRelationshipResponseDto> {
    const relationship = await this.loadForClient(user, id);
    if (relationship.status !== RelationshipStatus.PENDING) {
      throw new BadRequestException(`Only pending invitations can be accepted (current: "${relationship.status}")`);
    }
    relationship.status = RelationshipStatus.ACTIVE;
    relationship.startedAt = new Date();
    const saved = await this.relationshipRepo.save(relationship);
    return this.buildRelationshipDto(saved);
  }

  async reject(user: User, id: string): Promise<{ success: boolean; message: string }> {
    const relationship = await this.loadForClient(user, id);
    if (relationship.status !== RelationshipStatus.PENDING) {
      throw new BadRequestException(`Only pending invitations can be rejected (current: "${relationship.status}")`);
    }
    relationship.status = RelationshipStatus.ENDED;
    relationship.endedAt = new Date();
    await this.relationshipRepo.save(relationship);
    return { success: true, message: "Invitation rejected" };
  }

  /** Client views their current ACTIVE relationship (their coach). */
  async findActiveForClient(user: User): Promise<ClientCoachResponseDto> {
    const relationship = await this.relationshipRepo.findOne({
      where: { clientId: user.id, status: RelationshipStatus.ACTIVE, isDeleted: false },
      relations: { coach: true, client: true },
      order: { startedAt: "DESC" }
    });
    if (!relationship) throw new NotFoundException("You do not have an active coach relationship");
    const dto = this.buildRelationshipDto(relationship);
    return { relationship: dto, coach: dto.coach };
  }

  /** Client lists their pending invitations. */
  async listInvitationsForClient(user: User): Promise<ClientInvitationResponseDto[]> {
    const relationships = await this.relationshipRepo.find({
      where: { clientId: user.id, status: RelationshipStatus.PENDING, isDeleted: false },
      relations: { coach: true },
      order: { createdAt: "DESC" }
    });
    return relationships.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      coach: { id: r.coach.id, name: r.coach.name, userId: r.coach.userId }
    }));
  }

  // ─── Internal guards / helpers ───────────────────────────────────────────

  /** Anonymous-looking 404 so outsiders cannot probe relationship existence. */
  private async loadOwnedBy(user: User, id: string): Promise<CoachClientRelationship> {
    const coach = await this.findCoachForUser(user.id);
    const relationship = await this.relationshipRepo.findOne({
      where: { id },
      relations: { coach: true, client: true }
    });
    if (!relationship || relationship.isDeleted) {
      throw new NotFoundException("Relationship not found");
    }
    const isClient = relationship.clientId === user.id;
    const isCoach = coach !== null && coach.id === relationship.coachId;
    if (!isClient && !isCoach) {
      throw new NotFoundException("Relationship not found");
    }
    return relationship;
  }

  private async loadForClient(user: User, id: string): Promise<CoachClientRelationship> {
    const relationship = await this.relationshipRepo.findOne({
      where: { id, clientId: user.id },
      relations: { coach: true, client: true },
      withDeleted: false
    });
    if (!relationship) throw new NotFoundException("Invitation not found");
    return relationship;
  }

  private async requireCoach(user: User): Promise<Coach> {
    const coach = await this.findCoachForUser(user.id);
    if (!coach) throw new ForbiddenException("You do not have a coach profile");
    return coach;
  }

  private findCoachForUser(userId: string): Promise<Coach | null> {
    return this.coachRepo.findOne({ where: { userId } });
  }

  private async toResponseDto(id: string): Promise<CoachClientRelationshipResponseDto> {
    const relationship = await this.relationshipRepo.findOne({
      where: { id },
      relations: { coach: true, client: true }
    });
    if (!relationship) throw new NotFoundException("Relationship not found");
    return this.buildRelationshipDto(relationship);
  }

  private buildRelationshipDto(relationship: CoachClientRelationship): CoachClientRelationshipResponseDto {
    return {
      id: relationship.id,
      status: relationship.status,
      startedAt: relationship.startedAt,
      endedAt: relationship.endedAt,
      createdAt: relationship.createdAt,
      updatedAt: relationship.updatedAt,
      coach: {
        id: relationship.coach.id,
        name: relationship.coach.name,
        userId: relationship.coach.userId
      },
      client: {
        id: relationship.client.id,
        name: relationship.client.name,
        email: relationship.client.email
      }
    };
  }

  private applyTransition(relationship: CoachClientRelationship, target: RelationshipStatus): void {
    relationship.status = target;
    if (target === RelationshipStatus.ACTIVE && !relationship.startedAt) {
      relationship.startedAt = new Date();
    }
    if (target === RelationshipStatus.ENDED || target === RelationshipStatus.BLOCKED) {
      relationship.endedAt = relationship.endedAt ?? new Date();
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; driverError?: { code?: string } };
    const code = e.driverError?.code ?? e.code;
    return code === "23505";
  }
}
