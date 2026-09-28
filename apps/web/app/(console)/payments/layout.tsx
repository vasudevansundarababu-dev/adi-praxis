import { NoAccess } from '@/components/no-access';
import { PaymentsTabs } from '@/components/payments/tabs';
import { getCurrentUser } from '@/lib/api';

/** Payments area (docs/SME-SUPPLY.md section 8): Finance, PMs and Admins. Tabs follow what each role may do. */
export default async function PaymentsLayout({ children }: { children: React.ReactNode }) {
  const user = (await getCurrentUser())!;
  const has = (r: string) => user.roles.includes(r as never);
  if (!has('ADMIN') && !has('PM') && !has('FINANCE')) return <NoAccess need="Finance, PMs and Admins" />;
  const finance = has('ADMIN') || has('FINANCE');
  const items = [
    { href: '/payments/pay-runs', label: 'Pay runs' },
    { href: '/payments/rate-cards', label: 'Rate cards' },
    ...(finance
      ? [
          { href: '/payments/earnings', label: 'Earnings and holds' },
          { href: '/payments/exceptions', label: 'Payout exceptions' },
          { href: '/payments/statements', label: 'Partner statements' },
        ]
      : []),
  ];
  return (
    <div className="space-y-6">
      <PaymentsTabs items={items} />
      {children}
    </div>
  );
}
