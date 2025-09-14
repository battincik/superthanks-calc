# YouTube Super Thanks Scraper (Puppeteer)

**Live console reporting · Decimal/“bin” parsing · JSON output (timestamped)**

This tool uses Puppeteer to parse public YouTube video pages and estimate totals for **Super Thanks** donations visible in comments. It **streams** findings to the console as they are discovered and prints a final summary without requiring you to open any output file.

> ⚠️ This is *not* an official metric. It parses *public* comments and applies heuristics. Use responsibly and respect YouTube’s Terms of Service.

---

## Features

- Reliable comment loading: mouse wheel + container + window scrolling
- Robust Super Thanks detection (keywords + UI badge/aria/title heuristics)
- Amount parsing:
  - Textual thousands: `2 bin`, `3bin`, `10 bin`
  - Grouping variants: `2000`, `3.000`, `10,000`, `10 000` (NBSP/narrow NBSP)
  - Decimals: `₺2.199,99`, `€1,234.56`, `$5.99`
- **Live console** stream of each finding and continuously updated per-currency totals
- Single **JSON** output with a **timestamped** filename (no CSV)
- Defensive engineering: URL canonicalization (drops extra params like `&ab_channel`), consent overlay handling, stalled-scroll recovery, duplicate suppression, safe shutdown

---

## Quick Start

```bash
npm init -y
npm i puppeteer
node superthanks.js "https://www.youtube.com/watch?v=VIDEO_ID" --seconds 25 --min 0 --out out/super-thanks --headful
````

**On Windows CMD:** always quote the URL if it contains `&ab_channel=...`
**This script canonicalizes** to `https://www.youtube.com/watch?v=VIDEO_ID`, so extra params are not required.

---

## Runner Scripts

### Windows (`run-superthanks.bat`)

Interactive prompts; safely passes URLs that contain `&...` parameters.

```bat
run-superthanks.bat
```

### macOS/Linux (`run-superthanks.sh`)

Interactive prompts; POSIX-compliant.

```bash
chmod +x run-superthanks.sh
./run-superthanks.sh
```

---

## CLI Options

* `--seconds <n>`: Scroll duration for the main pass (default: `25`)
* `--min <n>`: Early stop once at least `n` top-level comment threads are loaded (default: `0` = disabled)
* `--out <prefix>`: Output file prefix (default: `out/super-thanks`)
* `--headful`: Launch visible Chrome (off by default)

Example:

```bash
node superthanks.js "https://youtu.be/VIDEO_ID" --seconds 40 --min 200 --out results/super-thanks --headful
```

---

## Output

A single JSON file is written:

```
out/
  super-thanks-<VIDEO_ID>-YYYYMMDD-HHMMSS.json
```

### JSON Structure

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "videoId": "VIDEO_ID",
  "generatedAt": "2025-09-14T10:42:31.123Z",
  "totals": { "TRY": 2199.99, "USD": 35 },
  "count": 7,
  "findings": [
    { "currency": "TRY", "amount": 199.99, "author": "Alice", "snippet": "..." },
    { "currency": "USD", "amount": 5, "author": "Bob", "snippet": "..." }
  ]
}
```

---

## Known Limits

* Heuristic matching may include false positives (e.g., a comment mentioning a price). We reduce noise by requiring “Super Thanks” cues, but public page parsing can’t be perfect.
* If comments are disabled or heavily moderated, results may be sparse.
* Very long threads may require higher `--seconds` to fully load.

---

## Troubleshooting

* **`'ab_channel' is not recognized...` (Windows):**
  This occurs when `&ab_channel=...` is interpreted by CMD as a command separator.
  **Fix:** Always put the URL in double quotes, or use the provided `.bat` which quotes it for you. Internally we canonicalize to `https://www.youtube.com/watch?v=VIDEO_ID`.

* **No results despite donations:**
  Increase `--seconds` (e.g., `40–60`). Ensure the video actually shows Super Thanks amounts in public comments.

* **Consent overlay blocks scrolling:**
  The script tries to accept common consent prompts. If your region shows a different prompt, report the selector text and we can add it.

---

## Legal & Ethics

* This parses **public** information. Do not attempt to access restricted data.
* Respect platform ToS and local laws. This project is for educational/research purposes.

---

## Contributing

PRs welcome — especially for:

* Additional locales/keywords for Super Thanks recognition
* Improved selectors for consent overlays
* Optional features: manual FX conversion, top-donors summary, etc.

---

## License

```
MIT License

Copyright (c) 2025 Bahattin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Direct terminal usage (outside the runners)

- **Windows CMD / PowerShell**

```bat
node superthanks.js "https://www.youtube.com/watch?v=VIDEO_ID"
node superthanks.js "https://www.youtube.com/watch?v=VIDEO_ID&ab_channel=ChannelName" --seconds 35 --min 150 --out out\super-thanks --headful
````

* **macOS/Linux**

```bash
node superthanks.js "https://www.youtube.com/watch?v=VIDEO_ID" --seconds 35 --min 150 --out out/super-thanks
```

If anything else needs to be tightened up (e.g., adding **manual FX conversion** or a **top donors** breakdown), say the word and I’ll fold it in.
