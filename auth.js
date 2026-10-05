(() => {
  const $ = (selector) => document.querySelector(selector);
  const supabase = window.supabaseClient;
  let mode = "login";

  function setMessage(message, type = "") {
    const element = $("#auth-message");
    element.textContent = message;
    element.className = `auth-message${type ? ` ${type}` : ""}`;
  }

  function setMode(nextMode) {
    mode = nextMode;
    const isSignUp = mode === "signup";
    $("#auth-title").textContent = isSignUp ? "Create your space." : "Welcome back.";
    $("#auth-intro").textContent = isSignUp
      ? "Create an account to sync your planner across devices."
      : "Sign in to pick up where you left off.";
    $("#auth-submit").textContent = isSignUp ? "Create account" : "Sign in";
    $("#auth-password").autocomplete = isSignUp ? "new-password" : "current-password";
    $("#auth-switch").textContent = isSignUp
      ? "Already have an account? Sign in"
      : "New to Zepra? Create an account";
    setMessage("");
  }

  async function initialize() {
    $("#auth-switch").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));

    if (!window.supabaseConfigured || !supabase) {
      if (window.supabaseConfigured && !supabase) {
        $("#auth-config-warning").textContent = "The Supabase client library did not load. Check your internet connection and allow cdn.jsdelivr.net, then refresh.";
      }
      $("#auth-config-warning").hidden = false;
      $("#auth-form").hidden = true;
      $("#auth-switch").hidden = true;
      return;
    }

    let data;
    let error;
    try {
      ({ data, error } = await supabase.auth.getSession());
    } catch (requestError) {
      console.error("Could not reach Supabase to check your session.", requestError);
      setMessage("Could not reach Supabase. Check your connection and try again.", "error");
      return;
    }
    if (error) {
      console.error("Could not check your Supabase session.", error);
      setMessage("Could not check your session. Refresh the page or try again.", "error");
    } else if (data.session) {
      $("#auth-form").hidden = true;
      $("#auth-switch").hidden = true;
      $("#auth-sign-out").hidden = false;
      setMessage(`Signed in as ${data.session.user.email || "your account"}.`);
    }

    $("#auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = $("#auth-submit");
      const email = $("#auth-email").value.trim();
      const password = $("#auth-password").value;
      submit.disabled = true;
      setMessage(mode === "signup" ? "Creating your account…" : "Signing in…");

      let result;
      try {
        result = mode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: new URL("index.html", window.location.href).href }
            })
          : await supabase.auth.signInWithPassword({ email, password });
      } catch (requestError) {
        submit.disabled = false;
        console.error(`Could not reach Supabase to ${mode === "signup" ? "register" : "sign in"}.`, requestError);
        setMessage("Could not reach Supabase. Check your connection and try again.", "error");
        return;
      }
      submit.disabled = false;

      if (result.error) {
        console.error(`Supabase ${mode} failed.`, result.error);
        setMessage(result.error.message, "error");
        return;
      }

      if (result.data.session) {
        window.location.replace("index.html");
      } else if (mode === "signup") {
        setMessage("Account created. Check your email to confirm your address, then sign in.", "success");
      } else {
        setMessage("Sign-in completed, but no session was returned. Please try again.", "error");
      }
    });

    $("#auth-sign-out").addEventListener("click", async () => {
      const button = $("#auth-sign-out");
      button.disabled = true;
      let signOutError;
      try {
        ({ error: signOutError } = await supabase.auth.signOut());
      } catch (requestError) {
        button.disabled = false;
        console.error("Could not reach Supabase to sign out.", requestError);
        setMessage("Could not reach Supabase. Check your connection and try again.", "error");
        return;
      }
      button.disabled = false;
      if (signOutError) {
        console.error("Could not sign out of Supabase.", signOutError);
        setMessage("Could not sign out. Please try again.", "error");
        return;
      }
      $("#auth-sign-out").hidden = true;
      $("#auth-form").hidden = false;
      $("#auth-switch").hidden = false;
      setMessage("You have been signed out.", "success");
    });
  }

  setMode("login");
  void initialize();
})();
