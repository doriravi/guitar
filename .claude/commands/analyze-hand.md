---
description: Analyze a hand photo for guitar chord capability using biomechanical heuristics
argument-hint: <path-to-hand-photo>
allowed-tools: [Bash]
---

# Guitar Hand Biomechanical Analysis

The user invoked this command with: $ARGUMENTS

## Instructions

Run the following Python script via Bash to analyze the hand photo and return a biomechanical chord capability report.

If no image path is provided in `$ARGUMENTS`, tell the user: "Please provide a path to a hand photo, e.g. `/analyze-hand ~/hand.jpg`" and stop.

Otherwise, run:

```bash
python -c "
import json, sys, base64, urllib.request, urllib.error, os

API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
if not API_KEY:
    print('Error: ANTHROPIC_API_KEY environment variable not set', file=sys.stderr)
    sys.exit(1)

MODEL = 'claude-opus-4-8'
URL   = 'https://api.anthropic.com/v1/messages'

image_path = sys.argv[1].strip()
if not os.path.exists(image_path):
    print(f'Error: file not found: {image_path}', file=sys.stderr)
    sys.exit(1)

ext = os.path.splitext(image_path)[1].lower()
mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'}
mime = mime_map.get(ext, 'image/jpeg')

with open(image_path, 'rb') as f:
    image_b64 = base64.b64encode(f.read()).decode()

system_prompt = 'You are an expert biomechanical analysis agent specializing in guitar ergonomics. Analyze the photograph of the user left hand and determine their physiological capacity for executing various guitar chord voicings.\n\nWhen analyzing the image, evaluate these structural data points:\n1. Absolute Span (Index to Pinky): Measure the maximum lateral spread between Digit 1 (Index) and Digit 4 (Pinky).\n2. Thumb Length and Pivot: Evaluate the thumb extension relative to the palm. A longer thumb indicates capacity for thumb-over neck grips.\n3. Index Finger Linearity: Assess the straightness and length of the index finger. Longer, flatter digits indicate higher baseline capacity for 6-string barres.\n4. Middle/Ring Lateral Splay: Analyze the natural resting gap between Digit 2 (Middle) and Digit 3 (Ring). Wider natural splay indicates higher lateral independence.\n5. Pinky Reach and Arch: Evaluate the pinky length relative to the distal joint of the ring finger.\n\nGrade the hand capabilities:\n- Grade 1 (Fundamentals): Default baseline. Open chords, basic triads.\n- Grade 2 (Clustered Complexity): Requires high lateral splay but low absolute span. Unlocks tight diminished inversions and Drop-2 jazz voicings.\n- Grade 3 (The Standard): Requires moderate span and long, linear index finger. Unlocks standard 6-string barres and minor 9ths.\n- Grade 4 (Brute Force): Requires massive absolute span and long thumb. Unlocks 5-fret power chords and thumb-fretted Hendrix chords.\n- Grade 5 (Extended Range): Requires maximum absolute span AND high lateral splay/pinky reach. Unlocks wide add9 chords and Allan Holdsworth-style open voicings.\n\nReturn a JSON report with this exact structure:\n{\n  \"biomechanical_profile\": {\n    \"absolute_span_assessment\": \"Small | Medium | Large\",\n    \"inferred_flexibility_splay\": \"Low | Medium | High\",\n    \"digit_analysis\": {\n      \"thumb\": \"Observation on pivot capacity\",\n      \"index\": \"Observation on barre capacity\",\n      \"middle_ring_cluster\": \"Observation on lateral independence\",\n      \"pinky\": \"Observation on reach and arch capacity\"\n    }\n  },\n  \"chord_capability_grades\": [\n    {\n      \"grade_level\": \"Grade X\",\n      \"status\": \"Optimal | Challenging | Structurally Restricted\",\n      \"supported_voicings\": [\"List of specific chords\"],\n      \"anatomical_reasoning\": \"Explanation based on visual evidence\"\n    }\n  ],\n  \"recommended_focus\": \"Specific advice\"\n}\n\nReturn ONLY the JSON — no markdown, no commentary.'

payload = json.dumps({
    'model': MODEL,
    'max_tokens': 2048,
    'system': system_prompt,
    'messages': [{
        'role': 'user',
        'content': [
            {
                'type': 'image',
                'source': {
                    'type': 'base64',
                    'media_type': mime,
                    'data': image_b64
                }
            },
            {
                'type': 'text',
                'text': 'Analyze this hand photo and return the biomechanical JSON report.'
            }
        ]
    }]
}).encode()

headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01'
}
req = urllib.request.Request(URL, data=payload, headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
    raw = data['content'][0]['text'].strip()
    if raw.startswith('\`\`\`'):
        raw = raw.split('\n', 1)[1]
        raw = raw.rsplit('\`\`\`', 1)[0].strip()
    parsed = json.loads(raw)
    print(json.dumps(parsed, indent=2))
except urllib.error.HTTPError as e:
    print(f'Claude API error {e.code}: {e.read().decode()}', file=sys.stderr)
    sys.exit(1)
except json.JSONDecodeError:
    print(raw)
" "$ARGUMENTS"
```

After the script runs, format the JSON output for the user as a readable markdown report:

1. **Biomechanical Profile** — span, splay, and one-line observation per digit
2. **Chord Capability Grades** — for each grade: status badge (✅ Optimal / ⚠️ Challenging / ❌ Structurally Restricted), supported voicings list, and anatomical reasoning
3. **Recommended Focus** — highlighted as a callout

If the script exits with an error, show the error message and suggest the user check the file path and format (JPG, PNG, WebP supported).
