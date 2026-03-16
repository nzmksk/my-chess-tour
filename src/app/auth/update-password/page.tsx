import NavBar from "@/components/NavBar";
import UpdatePasswordForm from "./_components/UpdatePasswordForm";

export const metadata = {
  title: "New Password — MY Chess Tour",
  description: "Set a new password for your MY Chess Tour account.",
};

export default function UpdatePasswordPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <UpdatePasswordForm />
    </div>
  );
}
