import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/brand';
import { LoginForm } from '@/components/login-form';
import AccessRequest from '@/components/AccessRequest';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  return (
    <SignInShell title="Sign in to Authoring" footer={<AccessRequest />}>
      <p className="mt-1 text-center text-sm text-fg-muted">For Admins, Program Managers and Validators.</p>
      <LoginForm />
    </SignInShell>
  );
}
