import Link from "next/link";
import NavBar from "@/app/_components/NavBar";

export const metadata = {
  title: "Welcome to MY Chess Tour",
  description: "Your account has been created successfully.",
};

type SuccessPageProps = {
  searchParams?: Promise<{ name?: string; email?: string; since?: string }>;
};

export default async function RegisterSuccessPage({
  searchParams,
}: SuccessPageProps) {
  const params = searchParams ? await searchParams : {};
  const name = params?.name ?? "Player";
  const email = params?.email ?? "";
  const since = params?.since ?? new Date().toLocaleDateString("en-MY", { month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <div className="auth-page">
        <div className="centered-col">
          <div
            className="auth-card card card--featured"
            style={{ textAlign: "center" }}
          >
            <div className="success-icon" role="img" aria-label="Chess piece">
              &#9823;
            </div>

            <h1 className="auth-heading" style={{ marginBottom: "var(--space-sm)" }}>
              Welcome to the Board
            </h1>

            <p
              style={{
                fontFamily: "var(--font-lato)",
                fontWeight: 300,
                fontSize: 14,
                color: "var(--color-text-secondary)",
                marginBottom: "var(--space-xl)",
                lineHeight: 1.7,
              }}
            >
              Account created and verified. You&apos;re now part of MY Chess Tour.
            </p>

            <div className="session-info" aria-label="Account summary">
              <div className="session-row">
                <span className="session-key">Name</span>
                <span className="session-val">{name}</span>
              </div>
              {email && (
                <div className="session-row">
                  <span className="session-key">Email</span>
                  <span className="session-val">{email}</span>
                </div>
              )}
              <div className="session-row">
                <span className="session-key">Member since</span>
                <span className="session-val">{since}</span>
              </div>
              <div className="session-row">
                <span className="session-key">Role</span>
                <span className="session-val">
                  <span className="badge badge--neutral">Player</span>
                </span>
              </div>
            </div>

            <Link href="/tournaments" className="btn-primary block text-center">
              Browse Tournaments
            </Link>

            <p className="auth-footer mt-sm">
              Or <Link href="/profile">complete your profile</Link> to add your
              rating
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
