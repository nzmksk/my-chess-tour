import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? "noreply@mychesstour.com";

export async function sendVerificationEmail(email: string, code: string) {
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Your MY Chess Tour verification code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="margin-bottom:8px">Verify your email</h2>
        <p style="color:#555;margin-bottom:24px">
          Enter the code below to complete your MY Chess Tour registration.
          It expires in <strong>10 minutes</strong>.
        </p>
        <div style="font-size:36px;font-weight:700;letter-spacing:0.25em;text-align:center;
                    background:#f4f4f4;border-radius:8px;padding:24px;margin-bottom:24px">
          ${code}
        </div>
        <p style="color:#888;font-size:13px">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    console.log("Failed to send verification email:", error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}
