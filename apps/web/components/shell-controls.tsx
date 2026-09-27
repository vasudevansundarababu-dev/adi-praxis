'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('praxis-theme', next ? 'dark' : 'light');
    } catch {}
    setDark(next);
  }
  return (
    <button type="button" onClick={toggle} className="rounded-md border border-line px-3 py-1 text-sm">
      {dark ? 'Light theme' : 'Dark theme'}
    </button>
  );
}

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }
  return (
    <button type="button" onClick={signOut} className="rounded-md border border-line px-3 py-1 text-sm">
      Sign out
    </button>
  );
}
