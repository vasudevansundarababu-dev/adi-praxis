import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FullLogo } from '@/components/brand';
import { PublicPageHelp } from '@/components/support/public-page-help';
import { LoginForm } from '@/components/login-form';
import AccessRequest from '@/components/AccessRequest';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-navy px-4 py-10 text-fg">
      <div className="w-full max-w-sm">
        <FullLogo />
        <div className="mt-6 rounded-xl bg-white p-6 shadow-xl">
          <h1 className="text-center text-lg font-semibold">Sign in to Authoring</h1>
          <p className="mt-1 text-center text-sm text-fg-muted">For Admins, Program Managers and Validators.</p>
          <LoginForm />
          <AccessRequest />
        </div>
      </div>
      <PublicPageHelp />
    </main>
  );
}
