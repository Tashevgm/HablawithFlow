const supabaseUrl = "https://ubetwjpyookwdgtfppim.supabase.co";
const supabasePublishableKey =
  "sb_publishable_3Sv0Oai5Ng2MC-89XaKr1g_vgwE0FVn";

if (window.supabase && !window.supabaseClient) {
  window.supabaseClient = window.supabase.createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });
}
