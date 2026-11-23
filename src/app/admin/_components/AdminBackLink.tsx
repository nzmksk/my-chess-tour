import Link from "next/link";

export default function AdminBackLink() {
  return (
    <div className="mb-4">
      <Link
        href="/admin/dashboard"
        className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
      >
        ← Back to Admin Dashboard
      </Link>
    </div>
  );
}
