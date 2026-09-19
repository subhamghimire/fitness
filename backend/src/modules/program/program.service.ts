import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Program } from "./entities/program.entity";
import { ProgramDay } from "./entities/program-day.entity";
import { ProgramWorkout } from "./entities/program-workout.entity";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { WorkoutTemplate } from "src/modules/workout/entities/workout-template.entity";
import { User } from "src/modules/users/entities/user.entity";
import { createPaginatedResponse } from "src/common/dto";
import {
  PaginatedProgramResponseDto,
  ProgramResponseDto,
  ProgramDayResponseDto,
  ProgramWorkoutResponseDto,
  CreateProgramDto,
  CreateProgramDayDto,
  CreateProgramWorkoutDto,
  UpdateProgramDto,
  ProgramQueryDto
} from "./dto";

@Injectable()
export class ProgramService {
  constructor(
    @InjectRepository(Program)
    private readonly programRepo: Repository<Program>,
    @InjectRepository(ProgramDay)
    private readonly dayRepo: Repository<ProgramDay>,
    @InjectRepository(ProgramWorkout)
    private readonly workoutRepo: Repository<ProgramWorkout>,
    @InjectRepository(Coach)
    private readonly coachRepo: Repository<Coach>,
    @InjectRepository(WorkoutTemplate)
    private readonly templateRepo: Repository<WorkoutTemplate>
  ) {}

  async create(user: User, dto: CreateProgramDto): Promise<ProgramResponseDto> {
    const coach = await this.requireCoach(user);
    const workouts = (dto.days ?? []).flatMap((d) => d.workouts ?? []);
    await this.assertTemplatesExist(workouts);

    const program = this.buildProgram(coach.id, dto);
    const saved = await this.programRepo.save(program);
    return this.toResponseDto(saved);
  }

  async findAllForCoach(user: User, query: ProgramQueryDto): Promise<PaginatedProgramResponseDto> {
    const coach = await this.requireCoach(user);
    const { page = 1, limit = 20 } = query;
    const where: Record<string, unknown> = { coachId: coach.id, isDeleted: false };
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [programs, total] = await this.programRepo.findAndCount({
      where,
      relations: { days: { workouts: true } },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit
    });

    return createPaginatedResponse(
      programs.map((p) => this.toResponseDto(p)),
      total,
      page,
      limit
    );
  }

  /** Coach-owned detail. Non-owners get a 404 so program ids cannot be pooled. */
  async findOneForCoach(user: User, id: string): Promise<ProgramResponseDto> {
    const coach = await this.requireCoach(user);
    const program = await this.programRepo.findOne({
      where: { id, coachId: coach.id, isDeleted: false },
      relations: { days: { workouts: true } }
    });
    if (!program) throw new NotFoundException("Program not found");
    return this.toResponseDto(program);
  }

  async update(user: User, id: string, dto: UpdateProgramDto): Promise<ProgramResponseDto> {
    const coach = await this.requireCoach(user);
    const program = await this.programRepo.findOne({
      where: { id, coachId: coach.id, isDeleted: false },
      relations: { days: { workouts: true } }
    });
    if (!program) throw new NotFoundException("Program not found");

    if (dto.name !== undefined) program.name = dto.name;
    if (dto.description !== undefined) program.description = dto.description;
    if (dto.isActive !== undefined) program.isActive = dto.isActive;

    if (dto.days !== undefined) {
      await this.replaceDays(program.coachId, program, dto.days);
    }

    const saved = await this.programRepo.save(program);
    return this.toResponseDto(saved);
  }

  async remove(user: User, id: string): Promise<{ success: boolean; message: string }> {
    const coach = await this.requireCoach(user);
    const program = await this.programRepo.findOne({
      where: { id, coachId: coach.id, isDeleted: false }
    });
    if (!program) throw new NotFoundException("Program not found");

    program.isDeleted = true;
    program.deletedAt = new Date();
    program.deletedBy = user.id;
    program.isActive = false;
    await this.programRepo.save(program);

    return { success: true, message: `Program "${program.name}" disabled` };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildProgram(coachId: string, dto: CreateProgramDto): Program {
    const program = this.programRepo.create({
      coachId,
      name: dto.name,
      description: dto.description ?? null,
      isActive: true
    });
    program.days = (dto.days ?? []).map((day, dayIdx) => this.buildProgramDay(program, day, dayIdx));
    return program;
  }

  private buildProgramDay(program: Program, dto: CreateProgramDayDto, dayIdx: number): ProgramDay {
    const day = this.dayRepo.create({
      program,
      weekNumber: dto.weekNumber,
      dayNumber: dto.dayNumber,
      orderIndex: dto.orderIndex ?? dayIdx,
      name: dto.name ?? null,
      notes: dto.notes ?? null
    });
    day.workouts = (dto.workouts ?? []).map((w, wIdx) =>
      this.workoutRepo.create({
        day,
        workoutTemplateId: w.workoutTemplateId,
        name: w.name ?? null,
        orderIndex: w.orderIndex ?? wIdx,
        notes: w.notes ?? null
      })
    );
    return day;
  }

  private async replaceDays(coachId: string, program: Program, dayDtos: CreateProgramDayDto[]): Promise<void> {
    const workouts = dayDtos.flatMap((d) => d.workouts ?? []);
    await this.assertTemplatesExist(workouts);

    const now = new Date();
    for (const oldDay of program.days ?? []) {
      oldDay.isDeleted = true;
      oldDay.deletedAt = now;
      oldDay.deletedBy = coachId;
      await this.dayRepo.save(oldDay);
    }
    program.days = dayDtos.map((day, dayIdx) => this.buildProgramDay(program, day, dayIdx));
  }

  private async assertTemplatesExist(workouts: CreateProgramWorkoutDto[]): Promise<void> {
    const ids = [...new Set(workouts.map((w) => w.workoutTemplateId))];
    if (ids.length === 0) return;
    const count = await this.templateRepo.count({ where: { id: In(ids) } });
    if (count !== ids.length) throw new BadRequestException("One or more workout templates do not exist");
  }

  private async requireCoach(user: User): Promise<Coach> {
    const coach = await this.coachRepo.findOne({ where: { userId: user.id } });
    if (!coach) throw new ForbiddenException("You do not have a coach profile");
    return coach;
  }

  private toResponseDto(program: Program): ProgramResponseDto {
    const days = (program.days ?? []).slice().sort((a, b) => a.weekNumber - b.weekNumber || a.dayNumber - b.dayNumber || a.orderIndex - b.orderIndex);
    return {
      id: program.id,
      coachId: program.coachId,
      name: program.name,
      description: program.description,
      isActive: program.isActive,
      days: days.map((d) => this.toDayDto(d)),
      createdAt: program.createdAt,
      updatedAt: program.updatedAt
    };
  }

  private toDayDto(day: ProgramDay): ProgramDayResponseDto {
    const workouts = (day.workouts ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    return {
      id: day.id,
      weekNumber: day.weekNumber,
      dayNumber: day.dayNumber,
      orderIndex: day.orderIndex,
      name: day.name,
      notes: day.notes,
      workouts: workouts.map((w) => this.toWorkoutDto(w))
    };
  }

  private toWorkoutDto(w: ProgramWorkout): ProgramWorkoutResponseDto {
    return {
      id: w.id,
      workoutTemplateId: w.workoutTemplateId,
      name: w.name,
      orderIndex: w.orderIndex,
      notes: w.notes
    };
  }
}
