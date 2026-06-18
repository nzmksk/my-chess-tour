import { createVerify } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { redis } from "@/services/redis/redis";

interface ChipWebhookPayload {
  id: string;
  status: string;
  reference_id: string;
}

function verifySignature(rawBody: string, signature: string): boolean {
  const publicKey = process.env.CHIP_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) throw new Error("CHIP_WEBHOOK_PUBLIC_KEY is not configured");

  const verifier = createVerify("SHA256");
  verifier.update(rawBody);
  return verifier.verify(publicKey, signature, "base64");
}

async function updateRegistrationStatus(
  registrationId: string,
  isPaid: boolean,
  now: string,
): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from("registrations")
    .update({
      status: isPaid ? "confirmed" : "failed_payment",
      confirmed_at: isPaid ? now : null,
    })
    .eq("id", registrationId);

  return error ? error.message : null;
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

  const now = new Date().toISOString();

  if (payment.status !== "pending") {
    // Payment already finalized — attempt registration update to recover from a prior partial failure.
    // Using payment.status (not the incoming status) ensures idempotency even on spurious retries.
    if (payment.registration_id) {
      const isPaidStatus = payment.status === "paid";
      const regErr = await updateRegistrationStatus(
        payment.registration_id,
        isPaidStatus,
        now,
      );
      if (regErr) {
        console.error("Registration recovery update error:", regErr);
        return NextResponse.json(
          { error: { code: "INTERNAL_ERROR", message: regErr } },
          { status: 500 },
        );
      }
    }

    if (payment.user_id) {
      await redis.del(`registrations:${payment.user_id}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  }

  const isPaid = status === "paid";

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
    const regErr = await updateRegistrationStatus(
      payment.registration_id,
      isPaid,
      now,
    );
    if (regErr) {
      console.error("Registration update error:", regErr);
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: regErr } },
        { status: 500 },
      );
    }
  }

  if (payment.user_id) {
    await redis.del(`registrations:${payment.user_id}`);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
