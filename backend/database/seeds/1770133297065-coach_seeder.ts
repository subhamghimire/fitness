import { DataSource } from 'typeorm';
import { Seeder, SeederFactoryManager } from 'typeorm-extension';
import { Coach } from 'src/modules/coach/entities/coach.entity';
import { CoachDocument } from 'src/modules/coach-document/entities/coach-document.entity';
import { CoachTemplate } from 'src/modules/coach-template/entities/coach-template.entity';
import { CoachProfile } from 'src/modules/coach-profile/entities/coach-profile.entity';
import { CoachVerification } from 'src/modules/coach-verification/entities/coach-verification.entity';
import { CoachDocumentStatus, CoachDocumentType } from 'src/modules/coach-document/enums';
import {
  CoachAccountStatus,
  CoachEligibility,
  CoachProfileVisibility,
  CoachVerificationStatus
} from 'src/modules/coach/enums';
import { CoachTemplateType, DiscountType } from 'src/modules/coach-template/enums/coach-template.enum';

export class CoachSeeder1770133297065 implements Seeder {
  track = false;

  public async run(
    dataSource: DataSource,
    factoryManager: SeederFactoryManager
  ): Promise<any> {
    const coachRepo = dataSource.getRepository(Coach);
    const documentRepo = dataSource.getRepository(CoachDocument);
    const templateRepo = dataSource.getRepository(CoachTemplate);
    const profileRepo = dataSource.getRepository(CoachProfile);
    const verificationRepo = dataSource.getRepository(CoachVerification);

    // Create or find System coach
    let systemCoach = await coachRepo.findOne({ where: { name: 'System' } });

    if (!systemCoach) {
      systemCoach = coachRepo.create({
        name: 'System',
        verificationStatus: CoachVerificationStatus.VERIFIED,
        accountStatus: CoachAccountStatus.ACTIVE,
        eligibility: CoachEligibility.ELIGIBLE,
        rank: 100
      });
      systemCoach = await coachRepo.save(systemCoach);
      console.log('Created System coach:', systemCoach.id);
    }

    const existingProfile = await profileRepo.findOne({ where: { coachId: systemCoach.id } });
    if (!existingProfile) {
      await profileRepo.save(
        profileRepo.create({
          coachId: systemCoach.id,
          bio: 'Official UdyamCoach system account providing default templates and resources.',
          visibility: CoachProfileVisibility.PUBLIC,
          averageRating: 0,
          ratingCount: 0
        })
      );
    }

    const existingVerification = await verificationRepo.findOne({ where: { coachId: systemCoach.id } });
    if (!existingVerification) {
      await verificationRepo.save(
        verificationRepo.create({
          coachId: systemCoach.id,
          status: CoachVerificationStatus.VERIFIED,
          submittedAt: new Date(),
          reviewedAt: new Date()
        })
      );
    }

    // Seed Coach Documents
    const documents: Partial<CoachDocument>[] = [
      {
        coachId: systemCoach.id,
        title: 'Official Certification',
        type: CoachDocumentType.CERTIFICATION,
        status: CoachDocumentStatus.APPROVED,
        badges: ['verified', 'official']
      },
      {
        coachId: systemCoach.id,
        title: 'Fitness Training License',
        type: CoachDocumentType.PROOF_OF_EXPERIENCE,
        status: CoachDocumentStatus.APPROVED,
        badges: ['licensed']
      }
    ];

    for (const doc of documents) {
      const exists = await documentRepo.findOne({
        where: { coachId: doc.coachId, title: doc.title }
      });
      if (!exists) {
        await documentRepo.save(documentRepo.create(doc));
      }
    }
    console.log('Coach documents seeded');

    // Seed Coach Templates
    const templates: Partial<CoachTemplate>[] = [
      {
        coachId: systemCoach.id,
        title: 'Beginner Full Body Workout',
        price: 0,
        type: CoachTemplateType.TEMPLATE,
        discount: 0,
        discountType: DiscountType.AMOUNT
      },
      {
        coachId: systemCoach.id,
        title: 'Intermediate Strength Program',
        price: 29.99,
        type: CoachTemplateType.PROGRAM,
        discount: 10,
        discountType: DiscountType.PERCENTAGE
      },
      {
        coachId: systemCoach.id,
        title: 'Advanced HIIT Training',
        price: 49.99,
        type: CoachTemplateType.PROGRAM,
        discount: 5,
        discountType: DiscountType.AMOUNT
      },
      {
        coachId: systemCoach.id,
        title: 'Home Workout Template',
        price: 0,
        type: CoachTemplateType.TEMPLATE,
        discount: 0,
        discountType: DiscountType.AMOUNT
      },
      {
        coachId: systemCoach.id,
        title: '12-Week Transformation',
        price: 99.99,
        type: CoachTemplateType.PROGRAM,
        discount: 20,
        discountType: DiscountType.PERCENTAGE
      }
    ];

    for (const template of templates) {
      const exists = await templateRepo.findOne({
        where: { coachId: template.coachId, title: template.title }
      });
      if (!exists) {
        await templateRepo.save(templateRepo.create(template));
      }
    }
    console.log('Coach templates seeded');
  }
}
