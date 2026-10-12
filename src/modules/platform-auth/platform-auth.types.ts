import type { UserDto } from '../me/me.types.js';

export interface PlatformMeDto {
  user: UserDto;
  role: { code: string; name: string };
  permissions: string[];
}

export interface PlatformSession extends PlatformMeDto {
  accessToken: string;
  expiresIn: number;
}
