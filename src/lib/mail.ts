// Transactional email through Resend's REST API (https://resend.com) — plain fetch, no SDK.
// Off until RESEND_API_KEY is set. MAIL_FROM must be on a domain verified in Resend; the default
// onboarding@resend.dev sender can only deliver to the Resend account owner's own address.
export async function sendMail(to: string, subject: string, text: string) {
  const key = import.meta.env.RESEND_API_KEY;
  if (!key || !to) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: import.meta.env.MAIL_FROM || 'InternFlow <onboarding@resend.dev>',
        to,
        subject,
        text,
      }),
    });
    if (!res.ok) console.error('Mail send failed:', res.status, await res.text());
  } catch (e) {
    // A failed notification must never fail the message that triggered it.
    console.error('Mail send error:', e);
  }
}
