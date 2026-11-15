/**
 * Wraps wizard fields the edit policy has locked. A disabled fieldset disables
 * every control inside it natively (inputs, selects, buttons), so a locked
 * section can't be edited however many controls it holds. Why it's locked is
 * explained once, by the banner WizardShell shows above the step.
 *
 * `.input:disabled` dims the text fields; buttons and checkboxes have no shared
 * class, so the fieldset dims those itself.
 */
export default function LockedFieldset({
  locked,
  children,
}: {
  locked: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      disabled={locked}
      className="m-0 min-w-0 border-0 p-0 [&:disabled_button]:cursor-not-allowed [&:disabled_button]:opacity-50 [&:disabled_input[type=checkbox]]:cursor-not-allowed [&:disabled_input[type=checkbox]]:opacity-50"
    >
      {children}
    </fieldset>
  );
}
