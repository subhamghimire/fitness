export class UserResponseDto { id: string; email: string; createdAt: string; }
export class AuthResponseDto { token: string; user: UserResponseDto; }
