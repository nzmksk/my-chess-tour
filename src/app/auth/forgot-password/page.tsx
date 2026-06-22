import NavBar from "@/components/NavBar";
import ForgotPasswordForm from "./_components/ForgotPasswordForm";

export const metadata = {
  title: "Reset Password",
  description: "Reset your MY Chess Tour account password.",
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_link:
    "That password reset link is invalid or has expired. Please request a new one.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error ? (ERROR_MESSAGES[error] ?? null) : null;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <ForgotPasswordForm initialError={initialError} />
    </div>
  );
}
