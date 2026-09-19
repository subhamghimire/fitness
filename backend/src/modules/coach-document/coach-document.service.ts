import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CoachDocument } from "./entities/coach-document.entity";
import { Coach } from "../coach/entities/coach.entity";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";
import { FilesService } from "../files/files.service";
import { FileEntity } from "../files/entities/file.entity";
import { FileFolder } from "../files/enums/file-folder.enum";
import { CoachDocumentStatus } from "./enums";
import { createPaginatedResponse } from "src/common/dto";
import { CreateCoachDocumentDto, UpdateCoachDocumentDto, CoachDocumentQueryDto, PaginatedCoachDocumentResponseDto, CoachDocumentResponseDto } from "./dto";

@Injectable()
export class CoachDocumentService {
  constructor(
    @InjectRepository(CoachDocument)
    private readonly repository: Repository<CoachDocument>,
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>,
    private readonly filesService: FilesService
  ) {}

  async create(actor: User, createDto: CreateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    const coach = await this.resolveOwnCoach(actor);

    const accessible = await this.filesService.isFileAccessible(createDto.fileId, actor, FileFolder.COACH_DOCUMENTS);
    if (!accessible) {
      throw new ForbiddenException("The provided file is not a document owned by the current user");
    }

    const doc = this.repository.create({
      title: createDto.title,
      coachId: coach.id,
      fileId: createDto.fileId,
      type: createDto.type,
      badges: createDto.badges ?? null,
      status: CoachDocumentStatus.PENDING
    });
    const saved = await this.repository.save(doc);
    return this.toResponseDto(saved);
  }

  async findAll(actor: User, query: CoachDocumentQueryDto): Promise<PaginatedCoachDocumentResponseDto> {
    const { coachId, status, type, page = 1, limit = 20, sortOrder = "DESC" } = query;
    const isAdmin = actor.role === UserRole.ADMIN;

    let scopedCoachId = coachId;
    if (!isAdmin) {
      const coach = await this.resolveOwnCoach(actor);
      if (coachId && coachId !== coach.id) {
        throw new ForbiddenException("You do not have permission to view another coach's documents");
      }
      scopedCoachId = coach.id;
    }

    const qb = this.repository.createQueryBuilder("doc").where("doc.isDeleted = :isDeleted", { isDeleted: false });
    if (scopedCoachId) qb.andWhere("doc.coachId = :coachId", { coachId: scopedCoachId });
    if (status) qb.andWhere("doc.status = :status", { status });
    if (type) qb.andWhere("doc.type = :type", { type });

    qb.orderBy("doc.createdAt", sortOrder === "ASC" ? "ASC" : "DESC");
    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const docs = await qb.getMany();

    return createPaginatedResponse(
      docs.map((d) => this.toResponseDto(d)),
      total,
      page,
      limit
    );
  }

  async findOne(actor: User, id: string): Promise<CoachDocumentResponseDto> {
    const doc = await this.findDocOrFail(id);
    this.assertCanManage(actor, doc);
    return this.toResponseDto(doc);
  }

  async getDownloadableFile(actor: User, id: string): Promise<FileEntity> {
    const doc = await this.findDocOrFail(id);
    this.assertCanManage(actor, doc);
    if (!doc.fileId) {
      throw new NotFoundException("This document has no file attached");
    }
    return this.filesService.getReadableFile(doc.fileId, actor);
  }

  async update(actor: User, id: string, updateDto: UpdateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    const doc = await this.findDocOrFail(id);
    this.assertCanManage(actor, doc);

    const isAdmin = actor.role === UserRole.ADMIN;
    if (updateDto.status !== undefined && !isAdmin) {
      throw new ForbiddenException("Only administrators can change the review status of a document");
    }

    if (updateDto.status !== undefined) doc.status = updateDto.status;
    if (updateDto.title !== undefined) doc.title = updateDto.title;
    if (updateDto.type !== undefined) doc.type = updateDto.type;
    if (updateDto.badges !== undefined) doc.badges = updateDto.badges;

    const saved = await this.repository.save(doc);
    return this.toResponseDto(saved);
  }

  async remove(actor: User, id: string): Promise<{ success: boolean; message: string }> {
    const doc = await this.findDocOrFail(id);
    this.assertCanManage(actor, doc);

    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.deletedBy = actor.id;
    await this.repository.save(doc);
    return { success: true, message: "Document deleted" };
  }

  private async findDocOrFail(id: string): Promise<CoachDocument> {
    const doc = await this.repository.findOne({ where: { id, isDeleted: false }, relations: { coach: true } });
    if (!doc) throw new NotFoundException("Document not found");
    return doc;
  }

  private assertCanManage(actor: User, doc: CoachDocument): void {
    const isOwner = doc.coach?.userId === actor.id;
    const isAdmin = actor.role === UserRole.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException("You do not have permission to access this document");
    }
  }

  private async resolveOwnCoach(actor: User): Promise<Coach> {
    const coach = await this.coachRepository.findOne({ where: { user: { id: actor.id }, isDeleted: false } });
    if (!coach) {
      throw new ForbiddenException("Only registered coaches can manage coach documents");
    }
    return coach;
  }

  private toResponseDto(doc: CoachDocument): CoachDocumentResponseDto {
    return {
      id: doc.id,
      coachId: doc.coachId,
      title: doc.title,
      type: doc.type,
      fileId: doc.fileId,
      status: doc.status,
      badges: doc.badges,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }
}
