import { CHANGE_GROUPS, type ChangelogEntry } from "@/lib/changelog";

/**
 * One release's changes, grouped as New / Improved / Fixed (#622). Shared by
 * the /changelogs page and the "What's new" dialog. Empty groups are left out.
 */
export function ChangelogChanges({
  entry,
  headingLevel: Heading = "h3",
}: {
  entry: ChangelogEntry;
  headingLevel?: "h3" | "h4";
}) {
  return (
    <div className="space-y-4">
      {CHANGE_GROUPS.map(({ key, label }) => {
        const items = entry[key];
        if (!items?.length) return null;
        return (
          <section key={key}>
            <Heading className="font-cinzel text-gold-muted mb-2 text-xs font-semibold tracking-widest uppercase">
              {label}
            </Heading>
            <ul className="font-lato text-text-secondary list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
