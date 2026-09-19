import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, MoreThanOrEqual, Repository } from "typeorm";
import { ProgramAssignment } from "./entities/program-assignment.entity";
import { Program } from "./entities/program.entity";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { CoachClientRelationship } from "src/modules/coach-client/entities/coach-client-relationship.entity";
import { WorkoutStat } from "src/modules/progress/entities/workout-stat.entity";
import { RelationshipStatus } from "src/modules/coach-client/enums";
import { ProgramAssignmentStatus, ACTIVE_ASSIGNMENT_STATUSES } from "./enums/program.enum";
import { AssignProgramDto, UpdateAssignmentDto, AssignmentQueryDto, ProgramAssignmentResponseDto, ProgramProgressDto, ProgramDayProgressDto } from "./dto";

const TERMINAL = [ProgramAssignmentStatus.COMPLETED, ProgramAssignmentStatus.CANCELLED];

/**
 * PROGRAM ASSIGNMENT SERVICE
 *
 * Assignments are the "specific program delivered to a specific client" record.
 * History preservation: assignments reaching COMPLETED / CANCELLED are frozen;
 * re-assigning the same program to the same client creates a new row (enforced
 * by a partial unique index on live assignments).
 */
@Injectable()
export class ProgramAssignmentService {
  constructor(
    @InjectRepository(ProgramAssignment)
    private readonly assignmentRepo: Repository<ProgramAssignment>,
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,
    @InjectRepository(Coach)
    private readonly coachRepo: Repository<Coach>,
    @InjectRepository(CoachClientRelationship)
    private readonly relationshipRepo: Repository<CoachClientRelationship>,
    @InjectRepository(WorkoutStat)
    private readonly workoutStatsRepo: Repository<WorkoutStat>
  ) {}

  // ─── Coach flow ──────────────────────────────────────────────────────────

  /**
   * Assign a coach's program to a client. The coach must own the program AND
   * have an ACTIVE relationship with the client — every assignment is rooted in
   * relationship ownership.
   */
  async assign(user: User, programId: string, dto: AssignProgramDto): Promise<ProgramAssignmentResponseDto> {
    const coach = await this.requireCoach(user);

    const program = await this.programRepo.findOne({
      where: { id: programId, coachId: coach.id, isDeleted: false }
    });
    if (!program) throw new NotFoundException("Program not found");
    if (!program.isActive) throw new BadRequestException("This program is inactive and cannot be assigned");

    const relationship = await this.relationshipRepo.findOne({
      where: { coachId: coach.id, clientId: dto.clientId },
      order: { startedAt: "DESC" }
    });
    if (!relationship || relationship.status !== RelationshipStatus.ACTIVE) {
      throw new ForbiddenException("You can only assign programs to clients with an active relationship");
    }

    if (dto.endDate && dto.endDate <= dto.startDate) {
      throw new BadRequestException("endDate must be after startDate");
    }

    const status = dto.status ?? ProgramAssignmentStatus.UPCOMING;
    if (![ProgramAssignmentStatus.UPCOMING, ProgramAssignmentStatus.ACTIVE].includes(status)) {
      throw new BadRequestException("A new assignment can only be upcoming or active");
    }

    const assignment = this.assignmentRepo.create({
      programId: program.id,
      coachId: coach.id,
      clientId: dto.clientId,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      status,
      isActive: ACTIVE_ASSIGNMENT_STATUSES.includes(status),
      startedAt: status === ProgramAssignmentStatus.ACTIVE ? new Date() : null
    });

    try {
      const saved = await this.assignmentRepo.save(assignment);
      return await this.loadResponse(saved.id);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new BadRequestException("This client already has a live assignment for this program");
      }
      throw err;
    }
  }

  /** Coach lists their own assignments (optionally filtered). */
  async listForCoach(user: User, query: AssignmentQueryDto): Promise<ProgramAssignmentResponseDto[]> {
    const coach = await this.requireCoach(user);
    const where: Record<string, unknown> = { coachId: coach.id, isDeleted: false };
    if (query.clientId) where.clientId = query.clientId;
    if (query.status) where.status = query.status;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const assignments = await this.assignmentRepo.find({
      where,
      relations: { client: true, program: { days: { workouts: true } } },
      order: { startDate: "DESC" }
    });
    return assignments.map((a) => this.toResponseDto(a));
  }

  /** Coach (or the assigned client) views a single assignment. */
  async findForActor(user: User, id: string): Promise<ProgramAssignmentResponseDto> {
    const assignment = await this.loadOwnedByActor(user, id);
    return this.toResponseDto(assignment);
  }

  /**
   * Coach manages an assignment lifecycle: start it, complete it, cancel it.
   * Terminal assignments are never touched (preserve history).
   */
  async manage(user: User, id: string, dto: UpdateAssignmentDto): Promise<ProgramAssignmentResponseDto> {
    const coach = await this.requireCoach(user);
    const assignment = await this.assignmentRepo.findOne({
      where: { id, coachId: coach.id },
      relations: { client: true, program: { days: { workouts: true } } }
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    if (TERMINAL.includes(assignment.status)) {
      throw new BadRequestException("Terminal assignments cannot be modified");
    }

    if (dto.startDate !== undefined) assignment.startDate = dto.startDate;
    if (dto.endDate !== undefined) assignment.endDate = dto.endDate;
    if (assignment.endDate && assignment.endDate <= assignment.startDate) {
      throw new BadRequestException("endDate must be after startDate");
    }

    if (dto.status !== undefined) {
      const target = dto.status;
      if (target === ProgramAssignmentStatus.ACTIVE) {
        if (![ProgramAssignmentStatus.UPCOMING, ProgramAssignmentStatus.ACTIVE].includes(assignment.status)) {
          throw new BadRequestException(`Cannot start an assignment that is "${assignment.status}"`);
        }
        assignment.status = ProgramAssignmentStatus.ACTIVE;
        assignment.startedAt = assignment.startedAt ?? new Date();
      } else if (target === ProgramAssignmentStatus.COMPLETED || target === ProgramAssignmentStatus.CANCELLED) {
        if (![ProgramAssignmentStatus.UPCOMING, ProgramAssignmentStatus.ACTIVE].includes(assignment.status)) {
          throw new BadRequestException(`Cannot end an assignment that is "${assignment.status}"`);
        }
        assignment.status = target;
        assignment.endedAt = assignment.endedAt ?? new Date();
      } else {
        throw new BadRequestException(`Cannot transition an assignment to "${target}"`);
      }
      assignment.isActive = ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status);
    }

    const saved = await this.assignmentRepo.save(assignment);
    return this.toResponseDto(saved);
  }

  // ─── Client flow ─────────────────────────────────────────────────────────

  /** Client lists their own assigned programs. */
  async listForClient(user: User, query: AssignmentQueryDto): Promise<ProgramAssignmentResponseDto[]> {
    const where: Record<string, unknown> = { clientId: user.id, isDeleted: false };
    if (query.status) where.status = query.status;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const assignments = await this.assignmentRepo.find({
      where,
      relations: { client: true, program: { days: { workouts: true } } },
      order: { startDate: "DESC" }
    });
    return assignments.map((a) => this.toResponseDto(a));
  }

  /** Client views one of their own assignments only. */
  async findForClient(user: User, id: string): Promise<ProgramAssignmentResponseDto> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id, clientId: user.id },
      relations: { client: true, program: { days: { workouts: true } } }
    });
    if (!assignment) throw new NotFoundException("Assignment not found");
    return this.toResponseDto(assignment);
  }

  // ─── Program progress ────────────────────────────────────────────────────

  /**
   * Progress of the client against the assigned plan. Only the assigning coach
   * or the assigned client may read it (ownership verified by loadOwnedByActor).
   *
   * Completion is computed by matching logged workouts (via the materialized
   * `workout_stats`) against the plan's scheduled calendar dates derived from
   * the assignment start date.
   */
  async progress(user: User, id: string): Promise<ProgramProgressDto> {
    const assignment = await this.loadOwnedByActor(user, id);
    const stats = await this.loadWindowStats(assignment);

    const performedDates = new Set(stats.map((s) => this.dateKey(s.startedAt)));
    const dayProgress = (assignment.program.days ?? [])
      .slice()
      .sort((a, b) => a.weekNumber - b.weekNumber || a.dayNumber - b.dayNumber || a.orderIndex - b.orderIndex)
      .map((day) => {
        const scheduledDate = this.scheduledDate(assignment.startDate, day.weekNumber, day.dayNumber);
        const completed = performedDates.has(this.dateKey(scheduledDate));
        return { day, scheduledDate, completed };
      });

    const totalWorkouts = dayProgress.reduce((sum, d) => sum + (d.day.workouts?.length ?? 0), 0);
    const completedWorkouts = dayProgress.reduce((sum, d) => sum + (d.completed ? (d.day.workouts?.length ?? 0) : 0), 0);
    const completedDays = dayProgress.filter((d) => d.completed).length;

    const windowEnd = assignment.endDate ?? new Date();
    const windowVolume = stats.filter((s) => s.startedAt >= assignment.startDate && s.startedAt <= windowEnd).reduce((sum, s) => sum + s.volumeKg, 0);

    return {
      assignmentId: assignment.id,
      programId: assignment.programId,
      programName: assignment.program.name,
      clientId: assignment.clientId,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      totalWorkouts,
      completedWorkouts,
      totalDays: dayProgress.length,
      completedDays,
      percentComplete: totalWorkouts > 0 ? Math.round((completedWorkouts / totalWorkouts) * 100) : 0,
      loggedWorkoutCount: stats.filter((s) => s.startedAt >= assignment.startDate && s.startedAt <= windowEnd).length,
      volumeKg: windowVolume,
      days: dayProgress.map(
        ({ day, scheduledDate, completed }): ProgramDayProgressDto => ({
          id: day.id,
          weekNumber: day.weekNumber,
          dayNumber: day.dayNumber,
          orderIndex: day.orderIndex,
          name: day.name,
          scheduledDate: scheduledDate <= new Date() ? scheduledDate : null,
          completed,
          workouts: (day.workouts ?? [])
            .slice()
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((w) => ({
              id: w.id,
              workoutTemplateId: w.workoutTemplateId,
              name: w.name,
              orderIndex: w.orderIndex,
              notes: w.notes
            }))
        })
      )
    };
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  private async loadOwnedByActor(user: User, id: string): Promise<ProgramAssignment> {
    const coach = await this.coachRepo.findOne({ where: { userId: user.id } });
    const assignment = await this.assignmentRepo.findOne({
      where: { id },
      relations: { client: true, program: { days: { workouts: true } } }
    });
    if (!assignment || assignment.isDeleted) throw new NotFoundException("Assignment not found");
    const isCoach = coach !== null && coach.id === assignment.coachId;
    const isClient = assignment.clientId === user.id;
    if (!isCoach && !isClient) throw new NotFoundException("Assignment not found");
    return assignment;
  }

  private async loadWindowStats(assignment: ProgramAssignment): Promise<WorkoutStat[]> {
    const from = new Date(assignment.startDate.getTime() - 86400000);
    const to = assignment.endDate ? new Date(assignment.endDate.getTime() + 86400000) : undefined;
    const where = to ? { userId: assignment.clientId, startedAt: Between(from, to) } : { userId: assignment.clientId, startedAt: MoreThanOrEqual(from) };
    return this.workoutStatsRepo.find({ where: where as never, order: { startedAt: "ASC" } });
  }

  private scheduledDate(startDate: Date, weekNumber: number, dayNumber: number): Date {
    const addDays = (weekNumber - 1) * 7 + (dayNumber - 1);
    return new Date(startDate.getTime() + addDays * 86400000);
  }

  /** UTC calendar date key (YYYY-MM-DD). */
  private dateKey(date: Date): string {
    return new Date(date).toISOString().slice(0, 10);
  }

  private async requireCoach(user: User): Promise<Coach> {
    const coach = await this.coachRepo.findOne({ where: { userId: user.id } });
    if (!coach) throw new ForbiddenException("You do not have a coach profile");
    return coach;
  }

  private async loadResponse(id: string): Promise<ProgramAssignmentResponseDto> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id },
      relations: { client: true, program: { days: { workouts: true } } }
    });
    if (!assignment) throw new NotFoundException("Assignment not found");
    return this.toResponseDto(assignment);
  }

  private toResponseDto(assignment: ProgramAssignment): ProgramAssignmentResponseDto {
    const days = (assignment.program.days ?? []).map((d) => ({
      id: d.id,
      weekNumber: d.weekNumber,
      dayNumber: d.dayNumber,
      orderIndex: d.orderIndex,
      name: d.name,
      notes: d.notes,
      workouts: (d.workouts ?? []).map((w) => ({
        id: w.id,
        workoutTemplateId: w.workoutTemplateId,
        name: w.name,
        orderIndex: w.orderIndex,
        notes: w.notes
      }))
    }));

    return {
      id: assignment.id,
      programId: assignment.programId,
      coachId: assignment.coachId,
      clientId: assignment.clientId,
      program: {
        id: assignment.program.id,
        coachId: assignment.program.coachId,
        name: assignment.program.name,
        description: assignment.program.description,
        isActive: assignment.program.isActive,
        days,
        createdAt: assignment.program.createdAt,
        updatedAt: assignment.program.updatedAt
      },
      client: {
        id: assignment.client.id,
        name: assignment.client.name,
        email: assignment.client.email
      },
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      status: assignment.status,
      isActive: assignment.isActive,
      startedAt: assignment.startedAt,
      endedAt: assignment.endedAt,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; driverError?: { code?: string } };
    const code = e.driverError?.code ?? e.code;
    return code === "23505";
  }
}
