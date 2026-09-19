import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { FileEntity } from "./entities/file.entity";
import { FilesService } from "./files.service";
import { FileFolder } from "./enums/file-folder.enum";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";

jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn()
  };
});

const makeFile = (over: Partial<FileEntity> = {}): FileEntity =>
  ({
    id: "file-1",
    originalName: "cert.pdf",
    filename: "abc.pdf",
    mimetype: "application/pdf",
    path: "uploads/coach-documents/abc.pdf",
    size: 10,
    type: FileFolder.COACH_DOCUMENTS,
    ownerId: "owner-1",
    ...over
  }) as FileEntity;

describe("FilesService access control", () => {
  const owner = { id: "owner-1", role: UserRole.USER } as User;
  const stranger = { id: "stranger-1", role: UserRole.USER } as User;
  const admin = { id: "admin-1", role: UserRole.ADMIN } as User;

  const makeService = () => {
    const repo = { findOne: jest.fn(), remove: jest.fn((f: FileEntity) => Promise.resolve(f)) };
    const service = new FilesService(repo as unknown as Repository<FileEntity>);
    return { service, repo };
  };

  describe("isFileAccessible", () => {
    it("is false when the file does not exist", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(null);

      await expect(service.isFileAccessible("file-1", owner, FileFolder.COACH_DOCUMENTS)).resolves.toBe(false);
    });

    it("is false when the folder does not match", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.isFileAccessible("file-1", owner, FileFolder.COACH_PROFILE)).resolves.toBe(false);
    });

    it("is false when the uploader is someone else", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.isFileAccessible("file-1", stranger, FileFolder.COACH_DOCUMENTS)).resolves.toBe(false);
    });

    it("is true for the uploader in the expected folder", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.isFileAccessible("file-1", owner, FileFolder.COACH_DOCUMENTS)).resolves.toBe(true);
    });
  });

  describe("getReadableFile", () => {
    it("throws when the file does not exist", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(null);

      await expect(service.getReadableFile("file-1", owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows anonymous access to unowned (public) files", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile({ ownerId: null }));

      await expect(service.getReadableFile("file-1")).resolves.toBeDefined();
    });

    it("forbids anonymous access to user-owned files", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.getReadableFile("file-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("forbids a different user from reading an owned file", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.getReadableFile("file-1", stranger)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows the owner and admins", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.getReadableFile("file-1", owner)).resolves.toBeDefined();
      await expect(service.getReadableFile("file-1", admin)).resolves.toBeDefined();
    });
  });

  describe("deleteFile", () => {
    it("forbids anonymous users from deleting an owned file", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.deleteFile("file-1")).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it("forbids a different user from deleting an owned file", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.deleteFile("file-1", stranger)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("lets the owner delete their own file", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile());

      await expect(service.deleteFile("file-1", owner)).resolves.toEqual({ success: true, message: "File deleted successfully" });
      expect(repo.remove).toHaveBeenCalled();
    });

    it("lets only admins delete unowned (system) files", async () => {
      const { service, repo } = makeService();
      repo.findOne.mockResolvedValue(makeFile({ ownerId: null }));

      await expect(service.deleteFile("file-1", owner)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.deleteFile("file-1", admin)).resolves.toEqual({ success: true, message: "File deleted successfully" });
    });
  });
});
