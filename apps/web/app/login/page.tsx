import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FullLogo } from '@/components/brand';
import { LoginForm } from '@/components/login-form';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  return (
    <main className="dark flex min-h-screen items-center justify-center bg-brand-charcoal px-4 text-fg">
      <div className="w-full max-w-sm">
        <FullLogo />
        <h1 className="mt-8 text-center text-lg font-semibold">Sign in to the console</h1>
        <p className="mt-1 text-center text-sm text-fg-muted">For Admins, Program Managers and Reviewers.</p>
        <LoginForm />
      </div>
    </main>
  );
}
