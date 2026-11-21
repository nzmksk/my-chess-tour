import { createClient } from "@supabase/supabase-js";
import { withAuditHeaders } from "@/services/supabase/audit-context";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    global: {
      fetch: (input, init) => fetch(input, withAuditHeaders(init)),
    },
  },
);
