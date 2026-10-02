# 🪔 Sundarkand Scheduling

Plan a Sundarkand path without the WhatsApp back-and-forth. The host proposes 2–5 time slots and shares one link. Everyone signs in with a one-time code sent to their email, votes for every slot that works (or says they can't make any), and the host confirms the final time.

**Stack:** plain HTML/JS · [Supabase](https://supabase.com) (database + email-code login) · [Resend](https://resend.com) (sends the code emails) · [Vercel](https://vercel.com) (hosting). All on free tiers.

## How it works

1. **Sign in:** enter your email, get a 6-digit code, type it in. No passwords.
2. **Register:** first-timers enter the name others will see next to their vote.
3. **Host:** create an event with a title, location, notes and 2–5 proposed times, then share the link.
4. **Participants:** open the link, sign in, tick every slot that works or "I can't make any", and optionally add a comment. You can change your answer until the host confirms.
5. **Host confirms:** press **Confirm** on the winning slot. Voting closes and everyone sees the confirmed time. (The host can reopen voting.)

## Setup (one time, about 15 minutes)

### 1. Supabase: database and login

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**.
3. **Project Settings → API**: copy the **Project URL** and **anon public** key into [`public/config.js`](public/config.js). Both are safe to commit. Never commit the `service_role` key.
4. **Authentication → Email Templates**: in the **Magic Link** and **Confirm signup** templates, replace the link with the code so people receive a number to type:
   ```html
   <h2>Your Sundarkand sign-in code</h2>
   <p>Enter this code to continue:</p>
   <p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
   <p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
   ```

### 2. Resend: email delivery

Supabase's built-in email only allows a few messages per hour, which is fine for testing but not for real use. Resend fixes that.

1. Create an account at [resend.com](https://resend.com).
2. **Domains → Add domain**, then add the DNS records it shows. Until a domain is verified, Resend can only send to your own email address.
3. **API Keys → Create API key** (sending access).
4. In Supabase, open **Authentication → Emails → SMTP Settings**, turn on custom SMTP, and enter:

   | Field | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | *your Resend API key* |
   | Sender email | e.g. `noreply@yourdomain.org` |
   | Sender name | `Sundarkand Scheduling` |

5. Optional: in **Authentication → Rate Limits**, raise the emails-per-hour limit.

The Resend key lives only in Supabase. It never goes in this repo.

### 3. Vercel: hosting

1. At [vercel.com](https://vercel.com), choose **Add New → Project** and import this GitHub repo.
2. Framework preset: **Other**. Leave the build command empty (`vercel.json` already points to `public/`).
3. Deploy. Every push to `main` redeploys automatically.
4. Back in Supabase, open **Authentication → URL Configuration** and set **Site URL** to your Vercel address.

## Local preview

```bash
npm run dev        # http://localhost:3000 (uses the Supabase project in config.js)
npm install && npm test   # checks the database functions against a real in-process Postgres
```

## Project layout

```
public/            the website (served as-is by Vercel)
  index.html       sign in, create an event, list your events
  event.html       view an event, vote or decline, host confirms
  lib.js           Supabase client, email-code login, registration
  config.js        Supabase URL + anon key (public)
supabase/schema.sql  tables, security rules, and functions
test/              database tests
vercel.json        hosting config (/e/<id> → event page)
```

## Privacy and security

- Everyone must sign in to see an event, and they also need its link.
- Other people see your **name** and votes, never your email.
- All writes go through database functions that check who is calling: only the host can confirm, people can only change their own vote, and votes close once a time is confirmed.
