import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Resend } from 'resend';

const PORT = process.env.PORT || 3002;
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Hyperspace <onboarding@resend.dev>';
const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL || 'ln@ulisse.tech';

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'hyperspace-landing-api' });
});

// POST /api/leads/demo — CTA "Request Demo" form
app.post('/api/leads/demo', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    // 1. Send internal notification to the team
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

    // 2. Send confirmation to the prospect
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
});

// POST /api/leads/configurator — Configurator wizard lead form
app.post('/api/leads/configurator', async (req, res) => {
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
    // 1. Send internal notification with full configuration details
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

    // 2. Send confirmation to the prospect
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
});

app.listen(PORT, () => {
  console.log(`\n🚀 Hyperspace Landing API running on port ${PORT}\n`);
});
