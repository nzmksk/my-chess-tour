import NavBar from "@/app/_components/NavBar";
import LogoutDialog from "./_components/LogoutDialog";

export const metadata = {
  title: "Sign Out — MY Chess Tour",
  description: "Sign out of your MY Chess Tour account.",
};

export default function LogoutPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <LogoutDialog />
    </div>
  );
}
