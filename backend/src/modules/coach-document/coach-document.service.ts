import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachDocument } from './entities/coach-document.entity';
import { createPaginatedResponse } from 'src/common/dto';
import {
  CreateCoachDocumentDto,
  UpdateCoachDocumentDto,
  CoachDocumentQueryDto,
  PaginatedCoachDocumentResponseDto,
  CoachDocumentResponseDto
} from './dto';

@Injectable()
export class CoachDocumentService {
  constructor(
    @InjectRepository(CoachDocument)
    private readonly repository: Repository<CoachDocument>
  ) {}

  async create(createDto: CreateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    const doc = this.repository.create(createDto);
    const saved = await this.repository.save(doc);
    return this.toResponseDto(saved);
  }

  async findAll(query: CoachDocumentQueryDto): Promise<PaginatedCoachDocumentResponseDto> {
    const { coachId, status, page = 1, limit = 20, sortOrder = 'DESC' } = query;
    const qb = this.repository.createQueryBuilder('doc');

    if (coachId) qb.andWhere('doc.coachId = :coachId', { coachId });
    if (status) qb.andWhere('doc.status = :status', { status });

    qb.orderBy('doc.createdAt', sortOrder === 'ASC' ? 'ASC' : 'DESC');
    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const docs = await qb.getMany();

    return createPaginatedResponse(docs.map(d => this.toResponseDto(d)), total, page, limit);
  }

  async findOne(id: string): Promise<CoachDocumentResponseDto> {
    const doc = await this.repository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException(`Document not found`);
    return this.toResponseDto(doc);
  }

  async update(id: string, updateDto: UpdateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    const doc = await this.repository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException(`Document not found`);
    Object.assign(doc, updateDto);
    const saved = await this.repository.save(doc);
    return this.toResponseDto(saved);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const doc = await this.repository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException(`Document not found`);
    await this.repository.remove(doc);
    return { success: true, message: 'Document deleted' };
  }

  private toResponseDto(doc: CoachDocument): CoachDocumentResponseDto {
    return {
      id: doc.id,
      coachId: doc.coachId,
      title: doc.title,
      imageUrl: doc.imageUrl,
      status: doc.status,
      badges: doc.badges,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }
}
