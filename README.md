# dark-eliza-proxy

A single serverless function (`api/chat.js`) that sits between the
[Dark-ELIZA](https://rebelwithoutacause.github.io/QA_Portfolio/apps/dark-eliza/)
frontend and the Gemini API. It exists purely to keep the API key off
the public GitHub Pages site — the browser calls this proxy, the proxy
calls Gemini with the key attached server-side, and only the reply
text goes back to the browser.

## Deploy (Vercel)

1. Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey) — no credit card required.
2. On [vercel.com](https://vercel.com), sign in with GitHub and **Import Project** → select this repo.
3. In the project's **Settings → Environment Variables**, add:
   - `GEMINI_API_KEY` = your key from step 1
4. Deploy. Vercel will give you a URL like `https://dark-eliza-proxy.vercel.app`.
5. That URL + `/api/chat` is the endpoint the frontend calls.

## Why it only allows one origin

`api/chat.js` sets `Access-Control-Allow-Origin` to
`https://rebelwithoutacause.github.io` so only the Dark-ELIZA page can
call it — this stops other sites from riding on the same free Gemini
quota.

## Cost

Uses `gemini-2.5-flash-lite` on the free tier (no cost, rate-limited
by Google rather than billed). If the quota is hit, Gemini returns an
error and the frontend falls back to its built-in offline responses.
