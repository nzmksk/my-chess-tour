// Normalizes a PEM public key read from an env var. Env managers store keys
// inconsistently: dotenv strips surrounding quotes and expands "\n", but
// platforms like Netlify store the value verbatim — so a key copied from a .env
// file can arrive wrapped in quotes and/or with literal "\n" sequences. Both
// break PEM parsing.
//
// Shared by the CHIP Collect and CHIP Send webhook routes, which both verify
// RSA signatures against a PEM key held in an env var.
export function normalizePublicKey(raw: string): string {
  let key = raw.trim();
  // Strip a single layer of matched surrounding quotes.
  if (
    key.length >= 2 &&
    ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'")))
  ) {
    key = key.slice(1, -1);
  }
  // Tolerate env values that carry literal "\n" instead of real newlines.
  return key.replace(/\\n/g, "\n");
}
