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
  - `POST /api/summarize-section` - Summarize one section using Gemini 2.0 Flash API
- **public/index.html** - Responsive spiritual-themed frontend (saffron/cream, Swamiji photo, book covers)
  - Upload → instant section list → click "Summarize" per section or "Summarize All"
  - Copy per section + Copy All buttons
- **Images**: `Swami pic.jpg`, `BGHSbooks.jpg` served from `/images/`

## What Works
- PDF upload and text extraction: OK (305 pages, 414K chars)
- Local section detection: Partially works but needs tuning
- Gemini summarization: Works for small sections (tested on Preface = 6.6K chars, got 10 bullets)

## The 4 Major Sections in Volume 1 (what user actually wants)
1. **Introduction**
2. **Gita Dhyanam** (meditation verses)
3. **Context of the Gita**
4. **Chapter 1**

Note: "Preface" is NOT a meaningful section - do not include it. Other volumes will have similar structure but with different chapter numbers.

## Known Issues To Fix Next Session

### 1. Section Detection Misses Key Sections
Local detection found: Preface, Introduction, Chapter 1
MISSING: **Gita Dhyanam** and **Context of the Gita** (the two most important ones besides Chapter 1!)
- These headings may not appear as standalone lines in PDF text extraction
- FIX NEEDED: Read the actual extracted text to see how these headings appear, then update regex patterns in `detectSections()` in server.js
- Also: filter OUT "Preface" from results (or make it optional) since user doesn't want it

### 2. Large Sections Hit Gemini Rate Limit
- "Introduction" section is 229,826 chars (~77K tokens) - too big for one Gemini API call on free tier
- FIX NEEDED: Sub-chunk large sections (>30K chars) into smaller pieces, summarize each, then combine bullets
- Add delays (60s) between sub-chunk calls to respect free tier TPM limits
- Show progress to user during multi-chunk summarization

### 3. Summary Quality Target
User expects ChatGPT / NotebookLM level quality. Gemini 2.0 Flash is good enough for this when it works.

## API Keys & Credentials (in .env)
- **Gemini API Key**: Set in `.env` as `GEMINI_API_KEY` (free tier, Google AI Studio)
- Also tried: Anthropic (no credits), Groq (12K TPM too low for 70B), OpenRouter (free models frequently rate-limited upstream)
- **Best option going forward**: Gemini 2.0 Flash direct API. Free tier has 1M TPM and 15 RPM - generous enough IF we don't exceed per-request limits.

## Lessons Learned
- Groq free tier: 70B model has only 12K TPM - useless for large text. 8B model has higher TPM but poor quality.
- OpenRouter free models: Frequently rate-limited upstream ("Provider returned error"). Unreliable for free tier.
- DeepSeek R1 via OpenRouter: Returns `<think>` blocks that break JSON parsing. Stripped with regex but model is slow (~25s) and also rate-limited.
- Gemini direct API: Works well but free tier rate limits accumulate across failed retries. Wait for reset (daily).
- Local section detection is better than LLM-based: instant, free, no API issues. Just needs proper regex patterns.
- ALWAYS sub-chunk large sections. Never send >30K chars in a single API call on free tiers.

## Dependencies (package.json)
express, multer, pdf-parse, @google/generative-ai, @anthropic-ai/sdk, groq-sdk, dotenv

## How to Run
```
cd "C:\Users\sbald\OneDrive\Documents\BGHS"
npm start
# Open http://localhost:3000
```