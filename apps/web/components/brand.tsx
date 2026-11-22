import Image from 'next/image';
import { PRODUCT_NAME } from '@praxis/shared/theme';
import mark from '@praxis/shared/brand/adi-labs-forge-mark-512.png';

/*
 * ADI Labs Forge lockup (owner, 22 Nov 2026; design repo shared/BRANDING.md §3, change F-09):
 * `[shield] ADI LABS-FORGE │ AUTHORING`. "ADI LABS" is the owner's choice; legal should confirm it before external
 * release (docs/DECISIONS.md). This file and its twin in apps/candidate are the only places the words may appear on
 * screen (apps/web/test/public-names.test.ts). Brand colours stay in the lockup, header, sign-in and primary buttons.
 */

type Tone = 'dark' | 'light';

/** The wordmark "ADI LABS-FORGE": white and light purple on navy, navy and purple on light backgrounds. */
function Wordmark({ tone, className = '' }: { tone: Tone; className?: string }) {
  return (
    <span className={`font-display font-bold uppercase tracking-[-0.02em] ${className}`}>
      <span className={tone === 'dark' ? 'text-white' : 'text-forge-navy'}>ADI LABS</span>
      <span className={tone === 'dark' ? 'text-forge-purple-light' : 'text-forge-purple'}>-FORGE</span>
    </span>
  );
}

/** The product name: Geist 600, uppercase, letter-spacing 0.14em. */
function ProductName({ tone, product, className = '' }: { tone: Tone; product: string; className?: string }) {
  return (
    <span className={`font-display font-semibold uppercase tracking-[0.14em] ${tone === 'dark' ? 'text-forge-product' : 'text-[#5d6475]'} ${className}`}>
      {product}
    </span>
  );
}

/** Horizontal lockup for the header: shield 30 px, wordmark, 1 px divider, product. */
export function BrandLockup({ product = PRODUCT_NAME, tone = 'dark' }: { product?: string; tone?: Tone }) {
  return (
    <span className="flex items-center gap-2.5" data-testid="brand-lockup">
      <Image src={mark} alt="" width={30} height={30} className="h-[30px] w-[30px]" />
      <Wordmark tone={tone} className="text-[15px] leading-none" />
      <span aria-hidden className={`h-[18px] w-px ${tone === 'dark' ? 'bg-forge-divider' : 'bg-[#d9dbe3]'}`} />
      <ProductName tone={tone} product={product} className="text-xs leading-none" />
    </span>
  );
}

/** Centred lockup for sign-in, sign-out, access-denied and error pages (navy page): shield, wordmark, product. */
export function FullLogo({ product = PRODUCT_NAME }: { product?: string }) {
  return (
    <div className="flex flex-col items-center text-center" data-testid="brand-hero">
      <Image src={mark} alt="ADI Labs Forge" priority width={112} height={112} className="h-28 w-28" />
      <Wordmark tone="dark" className="mt-4 text-2xl leading-none" />
      <ProductName tone="dark" product={product} className="mt-2 text-sm" />
    </div>
  );
}

/** Header brand: the horizontal lockup on the navy bar. */
export function NavBrand() {
  return <BrandLockup />;
}

/**
 * Navy sign-in page shell (sign-in, change password, and the other unauthenticated pages): centred lockup and one
 * white card holding the heading and form. The card is themed light so the forms keep readable colours; the primary
 * button is the brand purple. `footer` sits on the navy below the card (sign-out and access-request links are styled
 * for a dark background).
 */
export function SignInShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-forge-navy px-4 py-10">
      <FullLogo />
      <div className="light mt-8 w-full max-w-sm rounded-2xl bg-white p-6 text-fg shadow-xl">
        <h1 className="text-center text-lg font-semibold">{title}</h1>
        {children}
      </div>
      {footer && <div className="w-full max-w-sm text-white">{footer}</div>}
    </main>
  );
}
