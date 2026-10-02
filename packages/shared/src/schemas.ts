import { z } from 'zod';
import { INTERNAL_ROLES, USER_STATUSES } from './roles';

/** Shared request/response schemas used by the API and the web apps. */

export const LoginRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const InternalUserDto = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  roles: z.array(z.enum(INTERNAL_ROLES)),
  status: z.enum(USER_STATUSES),
  clientId: z.string().uuid(),
  /** True while the user still has a temporary password an Admin issued. */
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
});
export type InternalUserDto = z.infer<typeof InternalUserDto>;

export const CreateUserRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(200),
  roles: z.array(z.enum(INTERNAL_ROLES)).min(1),
  /** Leave out to have Praxis generate a temporary password (returned once). */
  password: z.string().min(12).max(200).optional(),
  /** The user must choose their own password at first sign-in (default). */
  requirePasswordChange: z.boolean().default(true),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UpdateUserRolesRequest = z.object({
  roles: z.array(z.enum(INTERNAL_ROLES)).min(1),
});

/** A user created or reset by an Admin; the temporary password is returned once and never stored in clear. */
export const UserWithTemporaryPasswordDto = InternalUserDto.extend({ temporaryPassword: z.string().optional() });

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12, 'Use at least 12 characters.').max(200),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const UpdateUserStatusRequest = z.object({
  status: z.enum(USER_STATUSES),
});

export const ErrorDto = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});
