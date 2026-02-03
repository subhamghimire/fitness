import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachTemplate } from './entities/coach-template.entity';
import { DiscountType } from './enums/coach-template.enum';
import { createPaginatedResponse } from 'src/common/dto';
import { CreateCoachTemplateDto, UpdateCoachTemplateDto, CoachTemplateQueryDto, PaginatedCoachTemplateResponseDto, CoachTemplateResponseDto } from './dto';

@Injectable()
export class CoachTemplateService {
  constructor(
    @InjectRepository(CoachTemplate)
    private readonly repository: Repository<CoachTemplate>
  ) {}

  async create(dto: CreateCoachTemplateDto): Promise<CoachTemplateResponseDto> {
    const template = this.repository.create(dto);
    const saved = await this.repository.save(template);
    return this.toResponseDto(saved);
  }

  async findAll(query: CoachTemplateQueryDto): Promise<PaginatedCoachTemplateResponseDto> {
    const { coachId, type, maxPrice, page = 1, limit = 20, sortOrder = 'DESC' } = query;
    const qb = this.repository.createQueryBuilder('template');

    if (coachId) qb.andWhere('template.coachId = :coachId', { coachId });
    if (type) qb.andWhere('template.type = :type', { type });
    if (maxPrice !== undefined) qb.andWhere('template.price <= :maxPrice', { maxPrice });

    qb.orderBy('template.createdAt', sortOrder === 'ASC' ? 'ASC' : 'DESC');
    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const templates = await qb.getMany();

    return createPaginatedResponse(templates.map(t => this.toResponseDto(t)), total, page, limit);
  }

  async findOne(id: string): Promise<CoachTemplateResponseDto> {
    const template = await this.repository.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    return this.toResponseDto(template);
  }

  async update(id: string, dto: UpdateCoachTemplateDto): Promise<CoachTemplateResponseDto> {
    const template = await this.repository.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    Object.assign(template, dto);
    const saved = await this.repository.save(template);
    return this.toResponseDto(saved);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const template = await this.repository.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    await this.repository.remove(template);
    return { success: true, message: 'Template deleted' };
  }

  private calculateFinalPrice(price: number, discount: number | null, discountType: DiscountType | null): number {
    if (!discount || !discountType) return price;
    if (discountType === DiscountType.PERCENTAGE) {
      return Math.round((price - (price * discount / 100)) * 100) / 100;
    }
    return Math.max(0, price - discount);
  }

  private toResponseDto(template: CoachTemplate): CoachTemplateResponseDto {
    return {
      id: template.id,
      coachId: template.coachId,
      title: template.title,
      price: Number(template.price),
      type: template.type,
      discount: template.discount ? Number(template.discount) : null,
      discountType: template.discountType,
      finalPrice: this.calculateFinalPrice(Number(template.price), template.discount ? Number(template.discount) : null, template.discountType),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    };
  }
}
