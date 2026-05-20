import NavBar from "@/components/NavBar";
import LogoutDialog from "./_components/LogoutDialog";

export const metadata = {
  title: "Sign Out",
  description: "Sign out of your MY Chess Tour account.",
};

export default function LogoutPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <LogoutDialog />
    </div>
  );
}
