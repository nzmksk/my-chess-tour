import { Suspense } from "react";
import NavBar from "@/app/_components/NavBar";
import RegisterForm from "./_components/RegisterForm";
import AuthCardSkeleton from "./_components/AuthCardSkeleton";

export const metadata = {
  title: "Create Account — MY Chess Tour",
  description:
    "Sign up for MY Chess Tour — Malaysia's premier competitive chess circuit.",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <Suspense fallback={<AuthCardSkeleton rows={4} />}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
