import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { CoachDocument } from "./entities/coach-document.entity";
import { CoachDocumentService } from "./coach-document.service";
import { Coach } from "../coach/entities/coach.entity";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";
import { CoachDocumentStatus, CoachDocumentType } from "./enums";

const makeDocument = (over: Partial<CoachDocument> = {}): CoachDocument =>
  ({
    id: "doc-1",
    coachId: "coach-1",
    title: "Certification",
    type: CoachDocumentType.CERTIFICATION,
    fileId: "file-1",
    status: CoachDocumentStatus.PENDING,
    badges: null,
    isDeleted: false,
    coach: { id: "coach-1", userId: "owner-1" } as Coach,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over
  }) as CoachDocument;

describe("CoachDocumentService authorization", () => {
  const owner = { id: "owner-1", role: UserRole.USER } as User;
  const stranger = { id: "stranger-1", role: UserRole.USER } as User;
  const admin = { id: "admin-1", role: UserRole.ADMIN } as User;

  const makeService = () => {
    const qb: Record<string, jest.Mock> = {};
    const self = () => qb;
    ["where", "andWhere", "orderBy", "skip", "take"].forEach((m) => (qb[m] = jest.fn(self)));
    qb.getCount = jest.fn().mockResolvedValue(0);
    qb.getMany = jest.fn().mockResolvedValue([]);

    const documentRepo = {
      findOne: jest.fn(),
      create: jest.fn((d: CoachDocument) => d),
      save: jest.fn((d: CoachDocument) => Promise.resolve(d)),
      createQueryBuilder: jest.fn(() => qb)
    };
    const coachRepo = { findOne: jest.fn() };
    const filesService = {
      isFileAccessible: jest.fn(),
      getReadableFile: jest.fn()
    };
    const service = new CoachDocumentService(documentRepo as unknown as Repository<CoachDocument>, coachRepo as unknown as Repository<Coach>, filesService as never);
    return { service, documentRepo, coachRepo, filesService };
  };

  describe("create", () => {
    it("forbids users without a coach profile", async () => {
      const { service, coachRepo, filesService } = makeService();
      coachRepo.findOne.mockResolvedValue(null);

      await expect(service.create(stranger, { title: "Cert", fileId: "file-1" })).rejects.toBeInstanceOf(ForbiddenException);
      expect(filesService.isFileAccessible).not.toHaveBeenCalled();
    });

    it("rejects a file that the coach does not own", async () => {
      const { service, coachRepo, filesService } = makeService();
      coachRepo.findOne.mockResolvedValue({ id: "coach-1", userId: "owner-1" });
      filesService.isFileAccessible.mockResolvedValue(false);

      await expect(service.create(owner, { title: "Cert", fileId: "file-1" })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("creates the document as PENDING scoped to the current coach", async () => {
      const { service, coachRepo, filesService, documentRepo } = makeService();
      coachRepo.findOne.mockResolvedValue({ id: "coach-1", userId: "owner-1" });
      filesService.isFileAccessible.mockResolvedValue(true);

      const result = await service.create(owner, { title: "Cert", fileId: "file-1" });

      expect(filesService.isFileAccessible).toHaveBeenCalledWith("file-1", owner, expect.anything());
      expect(documentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ coachId: "coach-1", status: CoachDocumentStatus.PENDING, fileId: "file-1" }));
      expect(result.status).toBe(CoachDocumentStatus.PENDING);
    });
  });

  describe("findOne", () => {
    it("throws when the document does not exist", async () => {
      const { service, documentRepo } = makeService();
      documentRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(owner, "doc-1")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("forbids a coach from reading another coach's document", async () => {
      const { service, documentRepo } = makeService();
      documentRepo.findOne.mockResolvedValue(makeDocument());

      await expect(service.findOne(stranger, "doc-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows the owner and admins", async () => {
      const { service, documentRepo } = makeService();
      documentRepo.findOne.mockResolvedValue(makeDocument());

      await expect(service.findOne(owner, "doc-1")).resolves.toBeDefined();
      await expect(service.findOne(admin, "doc-1")).resolves.toBeDefined();
    });
  });

  describe("update", () => {
    it("forbids owners from changing the review status", async () => {
      const { service, documentRepo } = makeService();
      documentRepo.findOne.mockResolvedValue(makeDocument());

      await expect(service.update(owner, "doc-1", { status: CoachDocumentStatus.APPROVED })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows admins to approve documents", async () => {
      const { service, documentRepo } = makeService();
      documentRepo.findOne.mockResolvedValue(makeDocument());

      const result = await service.update(admin, "doc-1", { status: CoachDocumentStatus.APPROVED });
      expect(result.status).toBe(CoachDocumentStatus.APPROVED);
    });
  });

  describe("findAll", () => {
    it("forbids a coach from listing another coach's documents by id", async () => {
      const { service, coachRepo } = makeService();
      coachRepo.findOne.mockResolvedValue({ id: "coach-1", userId: "owner-1" });

      await expect(service.findAll(owner, { coachId: "coach-2" } as never)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("remove", () => {
    it("forbids strangers from deleting a document", async () => {
      const { service, documentRepo } = makeService();
      documentRepo.findOne.mockResolvedValue(makeDocument());

      await expect(service.remove(stranger, "doc-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("soft-deletes for the owner", async () => {
      const { service, documentRepo } = makeService();
      documentRepo.findOne.mockResolvedValue(makeDocument());

      const result = await service.remove(owner, "doc-1");
      expect(result.success).toBe(true);
      expect(documentRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isDeleted: true, deletedBy: "owner-1" }));
    });
  });
});
