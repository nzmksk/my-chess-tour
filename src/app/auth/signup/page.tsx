import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import SignUpForm from "./_components/SignUpForm";
import AuthCardSkeleton from "./_components/AuthCardSkeleton";

export const metadata = {
  title: "Create Account",
  description:
    "Sign up for MY Chess Tour — Malaysia's premier competitive chess circuit.",
};

export default async function SignUpPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <Suspense fallback={<AuthCardSkeleton rows={4} />}>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
