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
    <button type="button" onClick={toggle} className="rounded-lg border border-white/30 px-3 py-1 text-sm text-white hover:bg-white/10">
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
    <button type="button" onClick={signOut} className="rounded-lg border border-white/30 px-3 py-1 text-sm text-white hover:bg-white/10">
      Sign out
    </button>
  );
}
