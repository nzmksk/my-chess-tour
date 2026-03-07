import fs from "fs";
import path from "path";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? "noreply@mychesstour.com";

function loadTemplate(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "lib/email-templates", name),
    "utf-8"
  );
}

export async function sendVerificationEmail(email: string, code: string) {
  const html = loadTemplate("verification.html").replace("{{code}}", code);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Your MY Chess Tour verification code",
    html,
  });

  if (error) {
    console.log("Failed to send verification email:", error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}
