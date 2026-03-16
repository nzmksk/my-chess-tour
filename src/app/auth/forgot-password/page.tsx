import NavBar from "@/components/NavBar";
import ForgotPasswordForm from "./_components/ForgotPasswordForm";

export const metadata = {
  title: "Reset Password — MY Chess Tour",
  description: "Reset your MY Chess Tour account password.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <ForgotPasswordForm />
    </div>
  );
}
