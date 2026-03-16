import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import ProfileForm from "../_components/ProfileForm";
import AuthCardSkeleton from "../_components/AuthCardSkeleton";

export const metadata = {
  title: "Player Profile — MY Chess Tour",
  description: "Set up your chess identity on MY Chess Tour.",
};

export default function SignUpProfilePage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <Suspense fallback={<AuthCardSkeleton rows={5} />}>
        <ProfileForm />
      </Suspense>
    </div>
  );
}
