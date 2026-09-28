import { redirect } from 'next/navigation';

export default function PaymentsIndex() {
  redirect('/payments/pay-runs');
}
