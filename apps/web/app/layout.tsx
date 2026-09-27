import type { Metadata } from 'next';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import './globals.css';

export const metadata: Metadata = {
  title: { template: '%s · ADI Praxis', default: 'ADI Praxis' },
  icons: { icon: mark.src, apple: mark.src },
};

// Applies the saved theme before paint to avoid a flash. The console defaults to light.
const themeScript = `try{if(localStorage.getItem('praxis-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
