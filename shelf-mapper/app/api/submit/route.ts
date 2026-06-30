import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const webhookUrl = process.env.SUBMIT_WEBHOOK_URL;

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "shelf_mapper_submitted",
          ...body,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error("Webhook failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
