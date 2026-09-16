# Fitness App Backend - Code Structure Guidelines

When working in this backend directory, you must follow the existing NestJS code structure and conventions.

## Architectural Conventions
- **Module Structure**: Code is organized into modules under `src/modules/<module-name>/`.
- Each module should contain:
  - `<module-name>.controller.ts`
  - `<module-name>.module.ts`
  - `<module-name>.service.ts`
  - `dto/` (contains Data Transfer Objects and an `index.ts` file for easy exporting)
  - `entities/` (contains TypeORM entities)
- **Entities**: Extend `AbstractEntity` from `src/entities/abstract.entity.ts`. This provides `id` (UUID), `createdAt`, `updatedAt`, `isDeleted`, `deletedAt`, and `deletedBy`.
- **Database Access**: Do not create custom repository classes (e.g., `user.repository.ts`). Instead, use the Data Mapper pattern by injecting standard TypeORM repositories directly into services using `@InjectRepository(Entity)`.
- **Soft Deletes**: Use the custom `isDeleted` flag and `deletedAt`/`deletedBy` fields for soft deletes. Do not use TypeORM's built-in `@DeleteDateColumn` unless refactoring everything. Use a `enableDisable(id)` method in the service and `PATCH :id/enable_disable` in the controller for toggling the deleted state. Hard deletes are done only if `isDeleted` is true.

## Controllers and Services
- **Swagger Documentation**: Use `@nestjs/swagger` decorators heavily in controllers: `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiParam`.
- **DTOs vs Entities**: Controllers should return Response DTOs, not raw entities. Services should implement a `toResponseDto(entity)` helper to transform entities before returning them.
- **Pagination**: Use `createPaginatedResponse` from `src/common/dto` for list endpoints. Provide a `PaginatedResponseDto`.

## Tooling
- Use `npm run format` for Prettier formatting and `npm run lint` for ESLint.
- The project uses TypeORM and Postgres/MySQL. Always use `npm run typeorm` and `npm run typeorm-extension` for DB management and migrations.
