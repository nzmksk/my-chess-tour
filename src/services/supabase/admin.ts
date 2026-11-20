import { createClient } from "@supabase/supabase-js";
import { withAuditHeaders } from "@/services/supabase/audit-context";

// Warning: The admin client bypasses all RLS policies.
// Only use it in server-side code for operations
// like CHIP webhook handlers and admin actions.
//
// Every request carries the current audit scope's actor and context headers
// (audit-context.ts), so the audit trail records who caused a write made
// through this client and why (#470).
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    global: {
      fetch: (input, init) => fetch(input, withAuditHeaders(init)),
    },
  },
);
