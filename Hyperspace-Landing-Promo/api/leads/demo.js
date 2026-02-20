const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Hyperspace <ln@ulisse.tech>';
const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL || 'ln@ulisse.tech';

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: [NOTIFICATION_EMAIL],
      subject: `🚀 New Demo Request — ${email}`,
      html: `
        <h2>New Demo Request</h2>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Source:</strong> Landing Page CTA</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <hr>
        <p style="color:#666;">This lead came from the "Request Demo" form on the Hyperspace landing page.</p>
      `,
    });

    await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Your Hyperspace Demo Request',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
          <h1 style="font-size: 24px; color: #0f172a;">Thanks for your interest in Hyperspace!</h1>
          <p style="font-size: 16px; line-height: 1.7; color: #475569;">
            We received your demo request and will be in touch within 24 hours to schedule a personalized walkthrough with your floor plan.
          </p>
          <p style="font-size: 16px; line-height: 1.7; color: #475569;">
            In under 30 minutes, you'll see how LiDAR-powered spatial intelligence can transform your venue — without cameras.
          </p>
          <p style="font-size: 14px; color: #94a3b8; margin-top: 2rem;">— The Hyperspace Team</p>
        </div>
      `,
    });

    console.log(`📧 Demo lead captured & emails sent: ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Resend email error:', err);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
}
