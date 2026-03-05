import { Suspense } from "react";
import NavBar from "@/app/_components/NavBar";
import VerifyForm from "../_components/VerifyForm";
import AuthCardSkeleton from "../_components/AuthCardSkeleton";

export const metadata = {
  title: "Verify Email — MY Chess Tour",
  description: "Verify your email address to complete registration.",
};

export default function RegisterVerifyPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <Suspense fallback={<AuthCardSkeleton rows={1} />}>
        <VerifyForm />
      </Suspense>
    </div>
  );
}
