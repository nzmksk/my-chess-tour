import { SignUpProvider } from "./_components/SignUpContext";

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SignUpProvider>{children}</SignUpProvider>;
}
