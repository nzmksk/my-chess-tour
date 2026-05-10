import { createClient } from '@supabase/supabase-js';

// Warning: The admin client bypasses all RLS policies.
// Only use it in server-side code for operations
// like CHIP webhook handlers and admin actions.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);
