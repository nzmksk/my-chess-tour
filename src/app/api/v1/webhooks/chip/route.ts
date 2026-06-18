import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { redis } from "@/services/redis/redis";

interface ChipWebhookPayload {
  id: string;
  status: string;
  reference_id: string;
}

function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.CHIP_WEBHOOK_SECRET;
  if (!secret) throw new Error("CHIP_WEBHOOK_SECRET is not configured");

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature") ?? "";

  if (!signature) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Missing signature" } },
      { status: 401 },
    );
  }

  let valid: boolean;
  try {
    valid = verifySignature(rawBody, signature);
  } catch (err) {
    console.error("CHIP signature verification error:", err);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Signature verification failed",
        },
      },
      { status: 500 },
    );
  }

  if (!valid) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid signature" } },
      { status: 401 },
    );
  }

  let payload: ChipWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ChipWebhookPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const { status, reference_id } = payload;

  if (status !== "paid" && status !== "payment_failed") {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const { data: payment, error: payErr } = await supabaseAdmin
    .from("payments")
    .select("id, registration_id, user_id, status")
    .eq("id", reference_id)
    .single();

  if (payErr || !payment) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Payment not found" } },
      { status: 404 },
    );
  }

  if (payment.status !== "pending") {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const isPaid = status === "paid";
  const now = new Date().toISOString();

  const { error: payUpdateErr } = await supabaseAdmin
    .from("payments")
    .update({
      status: isPaid ? "paid" : "failed",
      paid_at: isPaid ? now : null,
    })
    .eq("id", payment.id);

  if (payUpdateErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: payUpdateErr.message } },
      { status: 500 },
    );
  }

  if (payment.registration_id) {
    const { error: regUpdateErr } = await supabaseAdmin
      .from("registrations")
      .update({
        status: isPaid ? "confirmed" : "failed_payment",
        confirmed_at: isPaid ? now : null,
      })
      .eq("id", payment.registration_id);

    if (regUpdateErr) {
      console.error("Registration update error:", regUpdateErr);
    }
  }

  if (payment.user_id) {
    await redis.del(`registrations:${payment.user_id}`);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
