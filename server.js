require("dotenv").config();
const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

// In-memory store for uploaded PDF text + sections
const uploads = new Map();
let uploadCounter = 0;

// Cerebras API (OpenAI-compatible, 1M free tokens/day)
async function callLLM(prompt) {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error("CEREBRAS_API_KEY is not set in .env");

  console.log(`  Cerebras call (${prompt.length} chars)...`);

  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama3.1-8b",
      max_completion_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Cerebras API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = data.choices[0].message.content.trim();
  console.log(`  Response (first 200 chars): ${text.slice(0, 200)}`);
  return text;
}

// Normalize IAST diacritics from PDF to common English spellings
// e.g. Gétä → Gita, Kåñëa → Krishna, çästra → shastra
function normalizeDiacritics(text) {
  return text
    // ç/Ç = ś → sh (e.g. çästra → shastra, Éçvara → Ishvara)
    .replace(/Ç/g, "Sh").replace(/ç/g, "sh")
    // ñ = ṣ → sh (e.g. Kåñëa → Krishna, mokña → moksha)
    .replace(/ñ/g, "sh")
    // å = ṛ → ri (e.g. Kåñëa → Krishna, Dhåtaräñöra → Dhritarashtra)
    .replace(/Å/g, "Ri").replace(/å/g, "ri")
    // ò = ḍ → d (e.g. Päëòava → Pandava)
    .replace(/ò/g, "d")
    // ö = ṭ → t (e.g. Dhåtaräñöra → Dhritarashtra)
    .replace(/ö/g, "t")
    // ë = ṇ → n (e.g. Näräyaëa → Narayana)
    .replace(/ë/g, "n")
    // ä/Ä = ā → a (long a)
    .replace(/Ä/g, "A").replace(/ä/g, "a")
    // é/É = ī → i (long i, e.g. Gétä → Gita, Éçvara → Ishvara)
    .replace(/É/g, "I").replace(/é/g, "i")
    // ü/Ü = ū → u (long u)
    .replace(/Ü/g, "U").replace(/ü/g, "u")
    // è = e (accent variant)
    .replace(/è/g, "e")
    // ì = i (accent variant)
    .replace(/ì/g, "i")
    // à = a (accent variant)
    .replace(/à/g, "a");
}

// Clean up PDF extracted text
function cleanText(text) {
  return text
    .replace(/\f/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/^\s*\d+\s*$/gm, "")
    .trim();
}

// ─── Local section detection - no LLM needed ───
// Only matches known BGHS section headings. Requires the line to be
// short (a standalone heading line) AND preceded by a blank line.
function detectSections(text) {
  const markers = [];
  const lines = text.split("\n");
  let charPos = 0;

  // Strict patterns: must match the FULL line (anchored both ends)
  const sectionPatterns = [
    { pattern: /^publisher'?s?\s*note$/i, name: "Publisher's Note" },
    { pattern: /^preface$/i, name: "Preface" },
    { pattern: /^acknowledgements?$/i, name: "Acknowledgements" },
    { pattern: /^introduction$/i, name: "Introduction" },
    { pattern: /^g[iīé]t[aāä]\s*dhy[aāä]nam$/i, name: "Gita Dhyanam" },
    { pattern: /^dhy[aāä]na?\s*[sś]lok[aāä]s?$/i, name: "Dhyana Slokas" },
    { pattern: /^context\s*(of\s*)?(the\s*)?g[iīé]t[aāä]$/i, name: "Context of the Gita" },
    { pattern: /^chapter\s*\d+/i, name: null }, // use matched text
    { pattern: /^epilogue$/i, name: "Epilogue" },
    { pattern: /^appendix/i, name: null },
    { pattern: /^glossary$/i, name: "Glossary" },
    { pattern: /^index$/i, name: "Index" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Only consider short lines preceded by a blank (or near start of doc)
    const prevBlank = i === 0 || lines[i - 1].trim() === "";
    if (line.length < 2 || line.length > 60 || !prevBlank) {
      charPos += lines[i].length + 1;
      continue;
    }

    for (const { pattern, name } of sectionPatterns) {
      if (pattern.test(line)) {
        // Skip if we already have this exact section name (duplicate heading in text)
        const sectionName = name || line.trim();
        const isDupe = markers.some(
          (m) => m.name === sectionName && charPos - m.startPos < 5000
        );
        if (!isDupe) {
          markers.push({ name: sectionName, startPos: charPos });
        }
        break;
      }
    }

    charPos += lines[i].length + 1;
  }

  return markers;
}

// ─── STEP 1: Upload PDF and identify sections (locally - instant, no API) ───
app.post("/api/extract", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    const pdfData = await pdfParse(req.file.buffer);
    let text = pdfData.text;

    if (!text || text.trim().length < 100) {
      return res.status(400).json({
        error: "Could not extract text. It may be a scanned/image PDF.",
      });
    }

    text = cleanText(text);
    console.log(`PDF: ${pdfData.numpages} pages, ${text.length} chars (cleaned)`);

    // Detect sections locally - instant, no API call needed
    let sectionMarkers = detectSections(text);
    console.log(`Local detection found ${sectionMarkers.length} sections:`, sectionMarkers.map(s => s.name));

    // Filter out Preface — not a meaningful section for study purposes
    sectionMarkers = sectionMarkers.filter(s => !/^preface$/i.test(s.name));

    if (!sectionMarkers.length) {
      return res
        .status(500)
        .json({ error: "Could not identify sections in this PDF." });
    }

    // Sort by position
    sectionMarkers.sort((a, b) => a.startPos - b.startPos);

    const sections = sectionMarkers.map((marker, i) => {
      const start = marker.startPos;
      const end =
        i < sectionMarkers.length - 1
          ? sectionMarkers[i + 1].startPos
          : text.length;
      const sectionText = text.slice(start, end).trim();
      return {
        name: marker.name,
        charCount: sectionText.length,
        wordCount: sectionText.split(/\s+/).length,
      };
    });

    // Store in memory
    const uploadId = String(++uploadCounter);
    uploads.set(uploadId, {
      text,
      sectionMarkers,
      pageCount: pdfData.numpages,
      createdAt: Date.now(),
    });

    // Auto-cleanup after 1 hour
    setTimeout(() => uploads.delete(uploadId), 3600000);

    console.log(
      `Upload ${uploadId}: found ${sections.length} sections -`,
      sections.map((s) => s.name).join(", ")
    );
    res.json({ uploadId, sections, pageCount: pdfData.numpages });
  } catch (err) {
    console.error("Extract error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Chunking helper for large sections ───
const CHUNK_CHAR_LIMIT = 25000; // max chars per LLM call
const CHUNK_DELAY_MS = 10000;   // delay between chunk calls to respect rate limits

function splitIntoChunks(text, limit) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // Find a paragraph break near the limit
    let splitAt = remaining.lastIndexOf("\n\n", limit);
    if (splitAt < limit * 0.5) splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.5) splitAt = limit; // hard cut as last resort
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  return chunks;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildPrompt(sectionName, text, chunkInfo) {
  const chunkNote = chunkInfo
    ? `\n(This is part ${chunkInfo.current} of ${chunkInfo.total} for this section. Summarize THIS part only.)`
    : "";
  // Roughly 1 bullet per 1500 chars of source text, minimum 5, max 25
  const targetBullets = Math.min(25, Math.max(5, Math.round(text.length / 1500)));
  return `You are creating study-revision notes from the Bhagavad Gita Home Study Course by Pujya Swami Dayananda Saraswati. The goal: help someone RETAIN what they read.

Section: "${sectionName}"${chunkNote}

FORMAT RULES:
- Group points under TOPIC HEADERS. Start each topic header with 📌 emoji followed by the topic name in CAPS (e.g. "📌 THE FOUR HUMAN PURSUITS").
- Under each topic header, write 2-5 takeaway bullets using varied emojis (🔑 for key insight, 💡 for teaching/revelation, ⚡ for important distinction, 🪷 for spiritual concept, 📖 for scriptural reference, 🎯 for practical takeaway, 🔄 for logical connection to next topic).
- Each bullet: concise but COMPLETE thought. No filler prose. Think "study flashcard" not "paragraph."
- Preserve Sanskrit terms with meaning in parentheses: e.g. mokṣa (liberation), dharma (order/righteousness).
- Capture the SEQUENCE and LOGICAL FLOW — how one topic leads to the next.
- Include key analogies, examples, or stories Swamiji uses — these aid retention.
- Aim for approximately ${targetBullets} bullets total (across all topic groups).

CRITICAL:
- Summarize ONLY from the text below. Do NOT add external knowledge.
- Do NOT use markdown formatting (no **, no ##). Just plain text with emojis.

Return JSON (no markdown fences, no extra text):
{ "bullets": ["📌 TOPIC NAME", "🔑 Key point here...", "💡 Another point...", "📌 NEXT TOPIC", "🔑 ..."] }

TEXT:
${text}`;
}

function parseLLMResponse(responseText) {
  try {
    return JSON.parse(responseText);
  } catch {
    const match = responseText.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { bullets: [] };
  }
}

// ─── STEP 2: Summarize a single section (SSE for progress) ───
app.get("/api/summarize-section", async (req, res) => {
  const uploadId = req.query.uploadId;
  const sectionIndex = parseInt(req.query.sectionIndex, 10);

  const data = uploads.get(uploadId);
  if (!data) {
    return res.status(404).json({ error: "Upload expired. Please re-upload." });
  }

  const markers = data.sectionMarkers;
  if (sectionIndex < 0 || sectionIndex >= markers.length) {
    return res.status(400).json({ error: "Invalid section index." });
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  function sendEvent(type, payload) {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  }

  const start = markers[sectionIndex].startPos;
  const end =
    sectionIndex < markers.length - 1
      ? markers[sectionIndex + 1].startPos
      : data.text.length;
  const sectionTextRaw = data.text.slice(start, end).trim();
  const sectionText = normalizeDiacritics(sectionTextRaw);
  const sectionName = markers[sectionIndex].name;

  console.log(`Summarizing "${sectionName}": ${sectionText.length} chars`);

  try {
    const chunks = splitIntoChunks(sectionText, CHUNK_CHAR_LIMIT);
    let allBullets = [];

    sendEvent("start", { totalChunks: chunks.length, sectionName });

    for (let c = 0; c < chunks.length; c++) {
      sendEvent("progress", {
        chunk: c + 1,
        totalChunks: chunks.length,
        status: "summarizing",
      });
      console.log(`  Chunk ${c + 1}/${chunks.length} (${chunks[c].length} chars)`);

      const chunkInfo = chunks.length > 1 ? { current: c + 1, total: chunks.length } : null;
      const responseText = await callLLM(buildPrompt(sectionName, chunks[c], chunkInfo));
      const parsed = parseLLMResponse(responseText);
      allBullets.push(...(parsed.bullets || []));

      sendEvent("progress", {
        chunk: c + 1,
        totalChunks: chunks.length,
        status: "done",
      });

      if (c < chunks.length - 1) {
        sendEvent("progress", {
          chunk: c + 1,
          totalChunks: chunks.length,
          status: "waiting",
        });
        console.log(`  Waiting ${CHUNK_DELAY_MS / 1000}s before next chunk...`);
        await sleep(CHUNK_DELAY_MS);
      }
    }

    console.log(`  "${sectionName}" done: ${allBullets.length} bullets`);
    sendEvent("complete", { bullets: allBullets });
    res.end();
  } catch (err) {
    console.error("Summarize error:", err.message);
    sendEvent("error", { message: err.message });
    res.end();
  }
});

app.listen(PORT, () => {
  const model = process.env.MODEL || "google/gemini-2.0-flash-exp:free";
  console.log(`BGHS server running at http://localhost:${PORT} (model: ${model})`);
});
