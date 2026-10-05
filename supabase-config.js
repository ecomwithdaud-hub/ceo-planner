(() => {
  const config = window.SUPABASE_CONFIG || {
    url: "https://dfgwogbcbfgqxmvevpgr.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmZ3dvZ2JjYmZncXhtdmV2cGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExOTEyNDQsImV4cCI6MjEwNjc2NzI0NH0.PxXSuH1v6HdVbvsA1mK2gUrFUxSuHtc_KCeBKocCzkI"
  };

  let validUrl = false;
  try {
    const url = new URL(config.url);
    validUrl =
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) &&
      !url.hostname.includes("YOUR_PROJECT_ID");
  } catch {
    validUrl = false;
  }
  const configured =
    validUrl &&
    typeof config.anonKey === "string" &&
    config.anonKey.length > 20 &&
    !config.anonKey.includes("YOUR_");

  window.supabaseConfigured = configured;
  window.supabaseClient = configured && window.supabase
    ? window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
})();
