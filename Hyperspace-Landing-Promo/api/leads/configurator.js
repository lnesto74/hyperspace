import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Hyperspace <ln@ulisse.tech>';
const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL || 'ln@ulisse.tech';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, company, role, venue, result } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const venueInfo = venue
    ? `${venue.width}${venue.unit} × ${venue.length}${venue.unit} | Height: ${venue.height}${venue.unit} | Type: ${venue.type || 'N/A'}`
    : 'Not provided';

  const resultInfo = result
    ? `LiDARs: ${result.lidars} | Coverage: ${result.coveragePct}% | Optimize: ${result.optimize} | Pricing: ${result.pricingMode}`
    : 'Not provided';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: [NOTIFICATION_EMAIL],
      subject: `⚙️ New Configuration Lead — ${email}`,
      html: `
        <h2>New Configurator Lead</h2>
        <table style="border-collapse:collapse; font-size:14px;">
          <tr><td style="padding:4px 12px 4px 0; font-weight:bold;">Email:</td><td>${email}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; font-weight:bold;">Company:</td><td>${company || '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; font-weight:bold;">Role:</td><td>${role || '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; font-weight:bold;">Venue:</td><td>${venueInfo}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; font-weight:bold;">Result:</td><td>${resultInfo}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; font-weight:bold;">Time:</td><td>${new Date().toISOString()}</td></tr>
        </table>
        <hr>
        <p style="color:#666;">This lead came from the Configurator Wizard on the Hyperspace landing page.</p>
      `,
    });

    await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Your Hyperspace Configuration',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
          <h1 style="font-size: 24px; color: #0f172a;">Your Hyperspace Configuration Is Ready</h1>
          <p style="font-size: 16px; line-height: 1.7; color: #475569;">
            Thanks for building your setup! Here's a summary:
          </p>
          <div style="background:#f8fafc; border-radius:8px; padding:16px; margin:16px 0; border:1px solid #e2e8f0;">
            <p style="margin:4px 0; font-size:14px;"><strong>Venue:</strong> ${venueInfo}</p>
            <p style="margin:4px 0; font-size:14px;"><strong>Configuration:</strong> ${resultInfo}</p>
          </div>
          <p style="font-size: 16px; line-height: 1.7; color: #475569;">
            We'll review your configuration and send you a detailed proposal within 24 hours.
          </p>
          <p style="font-size: 14px; color: #94a3b8; margin-top: 2rem;">— The Hyperspace Team</p>
        </div>
      `,
    });

    console.log(`📧 Configurator lead captured & emails sent: ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Resend email error:', err);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
}
