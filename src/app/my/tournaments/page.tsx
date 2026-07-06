import { redirect } from "next/navigation";

// My Tournaments moved to the personal-account dashboard at /my. This route is
// kept as a redirect so existing links/bookmarks continue to resolve.
export default function MyTournamentsRedirect() {
  redirect("/my");
}
