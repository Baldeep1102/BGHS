Operating Principles
1. Plan Before Coding

Before writing any code, describe your proposed approach.

Wait for explicit approval before proceeding.

If any requirement is unclear or ambiguous, ask clarifying questions first.

Do not assume missing requirements.

2. Limit Scope of Changes

If a task requires changes to more than 3 files, stop.

Break the task into smaller, well-defined sub-tasks.

Present the sub-task plan and wait for approval before proceeding.

3. After Writing Code

After completing any implementation:

List potential failure points.

Describe what could break.

Suggest specific tests to cover edge cases and regressions.

4. Bug-Fixing Protocol

When handling a bug:

First, write a test that reproduces the bug.

Confirm the test fails.

Fix the issue.

Verify the test passes.

Ensure no regressions are introduced.

Do not fix bugs without first reproducing them in a test.

5. Continuous Improvement Rule

Whenever the user corrects you, extract the lesson.

Add a new explicit rule to this CLAUDE.md file to prevent repeating the mistake.

Show the updated rule before proceeding.

---

# Project Status & Context

## What This Project Is
A web app to upload Bhagavad Gita Home Study Course PDF volumes and generate section-by-section summaries. The summaries should be ONLY from the text, not external knowledge. Copy buttons for sharing.

## Current Architecture
- **server.js** - Express backend with:
  - `POST /api/extract` - Upload PDF, extract text with `pdf-parse`, detect sections LOCALLY (no API), store in memory
  - `GET /api/summarize-section` - SSE endpoint: summarizes one section using Cerebras API (Llama 3.1 8B), streams chunk progress to frontend
  - `normalizeDiacritics()` - Converts IAST transliteration from PDF (Gétä→Gita, Kåñëa→Krishna, etc.) before sending to LLM
  - `splitIntoChunks()` - Auto-splits sections >25K chars at paragraph breaks
- **public/index.html** - Responsive spiritual-themed frontend (saffron/cream, Swamiji photo, book covers)
  - Upload → instant section list → click "Summarize" per section or "Summarize All"
  - SSE-based progress: shows "Part 2 of 5..." during chunked summarization
  - Topic headers (📌) styled as bold sub-headings, emoji bullets for takeaways
  - Copy per section + Copy All buttons
- **Images**: `Swami pic.jpg`, `BGHSbooks.jpg` served from `/images/`

## What Works (ALL FIXED)
- PDF upload and text extraction: OK (305 pages, 414K chars)
- Local section detection: FIXED - detects all 4 sections (Introduction, Gita Dhyanam, Context of the Gita, Chapter 1)
- IAST diacritics normalization: FIXED - Gétä→Gita, Kåñëa→Krishna, etc.
- Preface filtered out automatically
- Auto-chunking for large sections with SSE progress
- Cerebras API: fast, free (1M tokens/day), no rate limit issues
- Summary format: emoji bullets grouped under 📌 topic headers (retention-focused study notes)

## The 4 Major Sections in Volume 1 (what user actually wants)
1. **Introduction** (~102K chars, 5 chunks)
2. **Gita Dhyanam** (~44K chars, 2 chunks)
3. **Context of the Gita** (~84K chars, 4 chunks)
4. **Chapter 1** (~176K chars, 7 chunks)

Note: "Preface" is NOT a meaningful section - filtered out automatically. Other volumes will have similar structure but with different chapter numbers.

## API Keys & Credentials (in .env — NOT committed to git)
- **CEREBRAS_API_KEY** - Current primary LLM (Llama 3.1 8B, 1M free tokens/day)
- **GEMINI_API_KEY** - Backup (free tier, rate limits are problematic)
- **ANTHROPIC_API_KEY** - Has key but $0 credits (user exploring $5 free credit claim)

## GitHub Repo
https://github.com/Baldeep1102/BGHS (public, main branch)

## Deployment: LIVE on Render
- **URL**: https://bghs.onrender.com (LIVE and working)
- **Platform**: Render free tier — no credit card required
- **Auto-deploys**: Every git push to main branch triggers a redeploy automatically
- **Caveat**: Spins down after 15 min inactivity — first request after idle takes ~30 sec to wake up
- **Env var set on Render**: `CEREBRAS_API_KEY` (set in Render dashboard → Environment)
- **No Dockerfile needed**: Render uses native Node.js detection from package.json

## WhatsApp / Social Share
- Open Graph meta tags added to `public/index.html`
- Preview image: `https://bghs.onrender.com/images/Swami%20pic.jpg` (Swamiji photo)
- og:title, og:description, og:image, og:url all set
- Favicon also set to Swami pic

## Hosting Options Evaluated (for reference)
- **Render** ✅ CHOSEN — Free, no card, auto-deploy from GitHub. Spins down after 15 min idle.
- **Railway** ❌ — 30 days free then $5/mo. No card needed but not truly free long-term.
- **Fly.io** ❌ — Free tier but requires credit card.
- **Cloudways** ❌ — Avoided to not risk existing "Revent" project on same server.
- **Octopus Deploy** ❌ — Not a hosting platform; it's a CI/CD orchestration tool. Irrelevant.
- **Koyeb** ❌ — Requires credit card even for free tier.
- **Render free tier spins down** — Known limitation, acceptable for study/occasional use.

## Lessons Learned
- Groq free tier: 70B model has only 12K TPM - useless for large text.
- OpenRouter free models: Frequently rate-limited upstream. Unreliable.
- Gemini direct API: Works but free tier rate limits are painful. Model fallback chain helps (2.0-flash → 1.5-flash → 1.5-flash-8b). `gemini-2.0-flash-lite` is DEPRECATED (404).
- Anthropic API: Separate billing from $20/mo Claude Pro subscription. New accounts may not auto-get $5 free credits anymore.
- Cerebras: Best free option found. 1M tokens/day, blazing fast inference, OpenAI-compatible API.
- PDF IAST diacritics: pdf-parse extracts special chars (é,ä,ë,ñ,ç,å,ò,ö). Must normalize before LLM or output looks garbled.
- Local section detection is better than LLM-based: instant, free, no API issues.
- ALWAYS sub-chunk large sections. Never send >25K chars in a single API call.
- Image filenames with spaces (e.g. "Swami pic.jpg") must be URL-encoded (%20) in HTML/meta tags.
- WhatsApp caches link previews — old recipients won't see updated preview even after og tags are added.

## Dependencies (package.json)
express, multer, pdf-parse, dotenv

## How to Run
```
cd "C:\Users\sbald\OneDrive\Documents\BGHS"
npm start
# Open http://localhost:3000
```