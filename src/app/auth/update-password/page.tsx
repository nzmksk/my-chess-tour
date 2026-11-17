import NavBar from "@/components/NavBar";
import UpdatePasswordForm from "./_components/UpdatePasswordForm";

export const metadata = {
  title: "New Password — MY Chess Tour",
  description: "Set a new password for your MY Chess Tour account.",
};

// `?invite=1` marks a member arriving from an organization invitation (see the
// members invite route): the same form, worded for a first password.
export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <UpdatePasswordForm invited={invite === "1"} />
    </div>
  );
}
