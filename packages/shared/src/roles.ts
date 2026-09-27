/** Internal roles (SPEC: Personas and roles). One user may hold several. Candidates are a separate user type. */
export const INTERNAL_ROLES = ['ADMIN', 'PM', 'REVIEWER'] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
