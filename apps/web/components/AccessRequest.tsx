'use client';

import { useRef, useState } from 'react';
import styles from './AccessRequest.module.css';

export default function AccessRequest() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const subject = 'ADI Praxis: access or password assistance request';
  const body = `Hello ADI Labs,\n\nPlease help me with access to ADI Praxis.\nMy email address: ${email.trim()}\n\nI need a new account or help recovering my existing access.\n\nThank you.`;
  const href = `mailto:admin@adi-labs.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <section className={styles.request}>
      <button type="button" className={styles.link} aria-expanded={open} aria-controls="access-request-form" onClick={() => setOpen(!open)}>
        Request access or password help
      </button>
      {open && (
        <div id="access-request-form" className={styles.panel}>
          <p>Our administrator reviews requests and arranges access manually.</p>
          <label htmlFor="request-email">Your email address</label>
          <input ref={input} id="request-email" name="request-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="access-request-help" />
          <p id="access-request-help">Opens your email app with a request to admin@adi-labs.ai. You must send the email to complete your request. Do not include any passwords.</p>
          <a className={styles.submit} href={href} onClick={(event) => {
            if (!input.current?.reportValidity()) event.preventDefault();
          }}>Open email request</a>
        </div>
      )}
    </section>
  );
}
