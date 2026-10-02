// Shared helpers: Supabase client, email one-time-code login, registration.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.SK_CONFIG || {};
export const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes('YOUR-PROJECT');
export const supabase = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (iso) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const errMsg = (e) => (e && (e.message || e.error_description)) || 'Something went wrong. Please try again.';

export async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}

/**
 * Makes sure someone is signed in and registered.
 * If not, shows the email → code → name screens inside `el` and resolves once done.
 * Resolves with { user, profile }.
 */
export async function requireUser(el, { heading = 'Sign in to continue' } = {}) {
  if (!configured) {
    el.innerHTML = `<div class="card"><h1>Almost there</h1>
      <p class="meta">Add your Supabase Project URL and anon key to <code>public/config.js</code>, then reload.</p></div>`;
    return new Promise(() => {});
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (session) return ensureProfile(el, session.user);

  return new Promise((resolve) => {
    let email = '';

    const showEmail = () => {
      el.innerHTML = `
        <h1>${esc(heading)}</h1>
        <p class="sub">We'll email you a one-time code. No password needed.</p>
        <form class="card" id="emailForm" novalidate>
          <label for="email">Email address</label>
          <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(email)}" required>
          <div class="actions"><button type="submit" id="go">Send code</button></div>
          <div class="error" id="error"></div>
        </form>`;
      const input = el.querySelector('#email');
      input.focus();
      el.querySelector('#emailForm').onsubmit = async (e) => {
        e.preventDefault();
        const err = el.querySelector('#error');
        const btn = el.querySelector('#go');
        err.textContent = '';
        email = input.value.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Please enter a valid email address.'; return; }
        btn.disabled = true; btn.textContent = 'Sending…';
        const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        btn.disabled = false; btn.textContent = 'Send code';
        if (error) { err.textContent = errMsg(error); return; }
        showCode();
      };
    };

    const showCode = () => {
      el.innerHTML = `
        <h1>Check your email</h1>
        <p class="sub">We sent a code to <strong>${esc(email)}</strong>. It may take a minute; check spam too.</p>
        <form class="card" id="codeForm" novalidate>
          <label for="code">One-time code</label>
          <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"
                 style="font-size:1.4rem;letter-spacing:.3em;text-align:center" required>
          <div class="actions">
            <button type="submit" id="verify">Verify</button>
            <button type="button" class="ghost" id="back">Use a different email</button>
          </div>
          <div class="error" id="error"></div>
        </form>`;
      const input = el.querySelector('#code');
      input.focus();
      el.querySelector('#back').onclick = showEmail;
      el.querySelector('#codeForm').onsubmit = async (e) => {
        e.preventDefault();
        const err = el.querySelector('#error');
        const btn = el.querySelector('#verify');
        err.textContent = '';
        const token = input.value.replace(/\s/g, '');
        if (!/^\d{6,10}$/.test(token)) { err.textContent = 'Enter the code from the email.'; return; }
        btn.disabled = true; btn.textContent = 'Checking…';
        const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
        btn.disabled = false; btn.textContent = 'Verify';
        if (error) { err.textContent = 'That code is wrong or expired. Try again or request a new one.'; return; }
        resolve(ensureProfile(el, data.user));
      };
    };

    showEmail();
  });
}

// Registration: first-time users pick the name others will see.
async function ensureProfile(el, user) {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (profile) return { user, profile };

  return new Promise((resolve) => {
    el.innerHTML = `
      <h1>Welcome! 🙏</h1>
      <p class="sub">One last step: tell us your name. Others will see it next to your vote.</p>
      <form class="card" id="nameForm" novalidate>
        <label for="name">Your name</label>
        <input id="name" maxlength="80" autocomplete="name" placeholder="e.g. Asha Sharma" required>
        <p class="meta" style="margin:8px 0 0">Signed in as ${esc(user.email)}</p>
        <div class="actions"><button type="submit" id="save">Continue</button></div>
        <div class="error" id="error"></div>
      </form>`;
    const input = el.querySelector('#name');
    input.focus();
    el.querySelector('#nameForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('#error');
      err.textContent = '';
      const { data, error } = await supabase.rpc('save_profile', { p_name: input.value });
      if (error) { err.textContent = errMsg(error); return; }
      resolve({ user, profile: data });
    };
  });
}

// Small "Signed in as … · Sign out" line for the header.
export function userBar(profile) {
  const bar = document.getElementById('userbar');
  if (!bar) return;
  bar.innerHTML = `<span>${esc(profile.name)}</span> · <a href="#" id="signout">Sign out</a>`;
  bar.querySelector('#signout').onclick = (e) => { e.preventDefault(); signOut(); };
}
