import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Home' };

const AREAS = {
  ADMIN: 'Manage users and roles now; the template catalog and demographic taxonomy follow.',
  PM: 'Create projects from published templates, then staff them and follow progress.',
  REVIEWER: 'Validate applicants, review submitted tasks and review RL Gym results.',
} as const;

export default async function HomePage() {
  const user = (await getCurrentUser())!;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {user.roles.map((role) => (
          <li key={role} className="rounded-lg border border-line bg-surface p-4">
            <h2 className="font-semibold">{role === 'PM' ? 'Program Manager' : role[0] + role.slice(1).toLowerCase()}</h2>
            <p className="mt-1 text-sm text-fg-muted">{AREAS[role]}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
