import NavBar from "@/components/NavBar";
import LoginForm from "./_components/LoginForm";

export const metadata = {
  title: "Sign In — MY Chess Tour",
  description: "Sign in to your MY Chess Tour account.",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <LoginForm />
    </div>
  );
}
