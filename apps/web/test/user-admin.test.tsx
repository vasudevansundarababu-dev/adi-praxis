import type { InternalUserDto } from '@praxis/shared';
import { describe, expect, it, vi } from 'vitest';
import { UserAdmin } from '@/components/users/user-admin';
import { html } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const admin: InternalUserDto = {
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'owner-admin@example.test',
  name: 'Owner Admin',
  roles: ['ADMIN'],
  status: 'ACTIVE',
  clientId: '00000000-0000-4000-8000-0000000000c1',
  mustChangePassword: false,
  lastLoginAt: null,
};

describe('Admin → Users role picker', () => {
  it('offers every internal role for a new user, with Admin ticked by default', () => {
    const markup = html(<UserAdmin users={[admin]} meId={admin.id} signInAt="https://app.example.test/login" />);
    for (const [role, label] of [
      ['ADMIN', 'Admin'],
      ['PM', 'PM'],
      ['REVIEWER', 'Validator'],
      ['FINANCE', 'Finance'],
    ]) {
      expect(markup).toMatch(new RegExp(`<label[^>]*for="new-user-role-${role}"[^>]*>.*?${label}</label>`));
    }
    expect(markup).toMatch(/id="new-user-role-ADMIN"[^>]*checked=""/);
    expect(markup).not.toMatch(/id="new-user-role-PM"[^>]*checked=""/);
  });
});
