import NavBar from "@/components/NavBar";
import LoginForm from "./_components/LoginForm";

export const metadata = {
  title: "Sign In",
  description: "Sign in to your MY Chess Tour account.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  const successMessage =
    message === "password-updated"
      ? "Password updated successfully. Please log in again with your new password."
      : undefined;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <LoginForm successMessage={successMessage} />
    </div>
  );
}
