import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { NAME_GROUPS } from "@/lib/reference/name-examples";

export const metadata: Metadata = {
  title: "How to Enter Your Name",
  description:
    "Examples of how to split Malay, Chinese, Indian and other Malaysian names into first and last name on MY Chess Tour.",
};

export default function NameGuidePage() {
  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="card card--featured p-6 sm:p-8">
          <div className="mb-8 text-center">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">How to enter your name</h1>
            <hr className="divider-gold" />
          </div>

          <div className="font-lato text-text-body space-y-6 text-sm leading-relaxed">
            <p className="text-text-secondary">
              Enter your name as it appears on your MyKad or passport. It goes
              on your tournament entries and results, and is used to register
              you with FIDE and MCF, so arbiters must be able to match it to
              your ID.
            </p>
            <ul className="text-text-secondary list-disc space-y-1 pl-5">
              <li>
                <strong className="text-text-primary">First name</strong> is
                your own name: the name people call you by.
              </li>
              <li>
                <strong className="text-text-primary">Last name</strong> is the
                part that comes from your family: your surname, or your
                father&apos;s name.
              </li>
              <li>
                Leave out bin, binti, a/l, a/p, s/o, d/o and anak. Keep every
                other word and its spelling as your ID has it. You don&apos;t
                need to type it in capitals.
              </li>
            </ul>

            {NAME_GROUPS.map((group) => (
              <section key={group.heading}>
                <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                  {group.heading}
                </h2>
                <p className="text-text-secondary mb-3">{group.note}</p>
                <div className="overflow-x-auto">
                  <table className="modal-table">
                    <thead>
                      <tr>
                        <th scope="col">On your ID</th>
                        <th scope="col">First name</th>
                        <th scope="col">Last name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.examples.map((example) => (
                        <tr key={example.onId}>
                          <td>{example.onId}</td>
                          <td className="text-text-primary">
                            {example.firstName}
                          </td>
                          <td className="text-text-primary">
                            {example.lastName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            <section>
              <h2 className="font-cinzel text-gold-muted mb-3 text-sm font-semibold tracking-widest uppercase">
                Only one name on your ID
              </h2>
              <p className="text-text-secondary">
                Both fields are required. If your ID shows a single name with no
                family part, type that name in both.
              </p>
            </section>

            <p className="text-text-muted text-xs">
              Once you&apos;ve signed up, only our support team can change your
              name, so check it against your ID first.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
