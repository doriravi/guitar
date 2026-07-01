package com.guitarreach.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * "Ask the expert" — AI melody/harmony suggestions for the Composer editor.
 *
 * The frontend sends the current composition (selected key + the beats already
 * laid down, each with a chord label and its 6-string tab) and asks for the next
 * chords or notes that would fit musically. We ask Claude — acting as an expert
 * in melody and harmony — for a few concrete suggestions, each returned as a
 * playable 6-character guitar tab (EADGBe convention, 'x' = muted, digits =
 * fret) so the frontend can drop them straight onto the beat track and score
 * each shape with the existing reach engine.
 *
 * Mirrors ExplainController: raw HTTP to the Anthropic Messages API, and the
 * same graceful-degradation contract — 503 when the key isn't configured, so the
 * frontend's `compose.get()` resolves to null and the feature simply hides.
 */
@RestController
@RequestMapping("/api/compose")
public class ComposeController {

    @Value("${anthropic.api.key:}")
    private String anthropicApiKey;

    private static final String ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
    // Melody/harmony reasoning benefits from a stronger model than the guide avatar.
    private static final String MODEL = "claude-sonnet-4-6";

    private static final String SYSTEM_PROMPT =
        "You are an expert guitar composer and music theorist helping a player build a song in the " +
        "Guitar Reach app.\n\n" +
        "IMPORTANT — tailor every suggestion to THIS PLAYER'S HAND. You are given their hand profile: " +
        "finger-gap measurements (cm) that describe their reach and flexibility, an ability label, and a " +
        "difficulty ceiling (1-10, where higher = harder stretch). Only suggest shapes this hand can " +
        "comfortably play: keep the difficulty at or below their ceiling, avoid wide fret spans and " +
        "hard barres for small/limited hands, and prefer compact, low-fret, few-finger voicings. If the " +
        "player's ability is small or very small, favor open chords and partial shapes.\n\n" +
        "You are also given the song's KEY and the BEATS already placed (each beat is a chord or a set of " +
        "notes, given as a chord label plus a 6-character guitar tab). Suggest what should come NEXT " +
        "so the piece stays musical and idiomatic in the given key AND is reachable for this hand.\n\n" +
        "Guitar tab convention: exactly 6 characters, one per string, low-E A D G B high-e order. " +
        "Each character is either a single fret digit 0-9 or 'x' for a muted/unplayed string. Prefer " +
        "open or low-fret shapes (frets 0-5); the smaller the hand, the more compact the shape.\n\n" +
        "Reply with STRICT JSON only, no markdown, in exactly this shape:\n" +
        "{\"suggestions\":[{\"label\":\"<chord or note name>\",\"tab\":\"<6 chars>\",\"reason\":\"<short why it fits>\"}]}\n" +
        "Give 3 to 5 suggestions. Each 'reason' must be under 15 words and should note musical fit and, " +
        "when relevant, why it suits their hand. Output nothing but the JSON object.";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping
    public ResponseEntity<String> compose(@RequestBody Map<String, Object> body) {
        if (anthropicApiKey == null || anthropicApiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"AI composition not configured on server\"}");
        }

        String key = orEmpty(String.valueOf(body.getOrDefault("key", "")));
        String want = orEmpty(String.valueOf(body.getOrDefault("want", "chords")));
        Object beatsObj = body.get("beats");
        Object handObj = body.get("hand");

        StringBuilder beatsDesc = new StringBuilder();
        if (beatsObj instanceof List<?> beats) {
            int i = 1;
            for (Object b : beats) {
                if (b instanceof Map<?, ?> bm) {
                    Object labelVal = bm.get("chordLabel");
                    Object tabVal = bm.get("tab");
                    String label = orEmpty(labelVal == null ? "" : String.valueOf(labelVal));
                    String tab = orEmpty(tabVal == null ? "" : String.valueOf(tabVal));
                    beatsDesc.append("  ").append(i++).append(". ")
                        .append(label.isBlank() ? "(notes)" : label)
                        .append(tab.isBlank() ? "" : " [" + tab + "]").append("\n");
                }
            }
        }
        if (beatsDesc.length() == 0) beatsDesc.append("  (empty — this is the start of the song)\n");

        String handDesc = describeHand(handObj);

        String userPrompt =
            "Key: " + (key.isBlank() ? "C major" : key) + "\n" +
            "The player wants suggestions for: " + (want.equals("notes") ? "single notes / a melody" : "chords") + "\n" +
            "Player's hand profile:\n" + handDesc +
            "Beats so far:\n" + beatsDesc;

        try {
            String payload = objectMapper.writeValueAsString(Map.of(
                "model", MODEL,
                "max_tokens", 700,
                "system", SYSTEM_PROMPT,
                "messages", new Object[] {
                    Map.of("role", "user", "content", userPrompt)
                }
            ));

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("x-api-key", anthropicApiKey);
            headers.set("anthropic-version", "2023-06-01");
            HttpEntity<String> req = new HttpEntity<>(payload, headers);

            ResponseEntity<String> resp = restTemplate.postForEntity(ANTHROPIC_URL, req, String.class);

            JsonNode root = objectMapper.readTree(resp.getBody());
            String text = root.at("/content/0/text").asText("").trim();

            // The model is asked for strict JSON; validate + normalize before returning
            // so the frontend always gets a clean { suggestions: [...] } shape.
            JsonNode parsed = parseSuggestions(text);
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(objectMapper.writeValueAsString(parsed));

        } catch (HttpClientErrorException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"AI error " + e.getStatusCode() + "\"}");
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage().replace("\"", "'") : "unknown error";
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"" + msg + "\"}");
        }
    }

    /**
     * Render the hand profile the frontend sent into a compact, prompt-friendly
     * description. Falls back to a generic small-hand note when absent, matching
     * the app's short-fingers target user.
     */
    private String describeHand(Object handObj) {
        if (!(handObj instanceof Map<?, ?> h)) {
            return "  (not provided — assume a small hand with limited reach)\n";
        }
        StringBuilder sb = new StringBuilder();
        appendField(sb, "Ability", h.get("abilityLabel"));
        appendField(sb, "Note", h.get("abilityNote"));
        appendField(sb, "Recommended max difficulty (1-10)", h.get("recommendedMaxDifficulty"));
        appendField(sb, "Difficulty ceiling to stay within (1-10)", h.get("difficultyCeiling"));
        // Finger-gap measurements (reach / flexibility), in cm.
        appendField(sb, "Thumb-to-index gap (cm)", h.get("thumbToIndex"));
        appendField(sb, "Index-to-middle gap (cm)", h.get("indexToMiddle"));
        appendField(sb, "Middle-to-ring gap (cm)", h.get("middleToRing"));
        appendField(sb, "Ring-to-little gap (cm)", h.get("ringToLittle"));
        Object fingers = h.get("fingerCapability");
        if (fingers != null && !String.valueOf(fingers).isBlank() && !"null".equals(String.valueOf(fingers))) {
            sb.append("  Per-finger capability (from photo analysis): ").append(fingers).append("\n");
        }
        return sb.length() == 0 ? "  (not provided — assume a small hand with limited reach)\n" : sb.toString();
    }

    private static void appendField(StringBuilder sb, String label, Object val) {
        if (val == null) return;
        String s = String.valueOf(val).trim();
        if (s.isEmpty() || "null".equals(s)) return;
        sb.append("  ").append(label).append(": ").append(s).append("\n");
    }

    /**
     * Extract and sanitize the suggestions array from the model's text. Tolerates
     * a stray code fence, and keeps only well-formed entries with a valid 6-char tab.
     */
    private JsonNode parseSuggestions(String text) throws Exception {
        String json = text;
        int start = json.indexOf('{');
        int end = json.lastIndexOf('}');
        if (start >= 0 && end > start) json = json.substring(start, end + 1);

        JsonNode root = objectMapper.readTree(json);
        JsonNode arr = root.get("suggestions");
        List<Map<String, String>> clean = new ArrayList<>();
        if (arr != null && arr.isArray()) {
            for (JsonNode s : arr) {
                String tab = orEmpty(s.path("tab").asText(""));
                if (!isValidTab(tab)) continue;
                clean.add(Map.of(
                    "label", orEmpty(s.path("label").asText("")),
                    "tab", tab,
                    "reason", orEmpty(s.path("reason").asText(""))
                ));
            }
        }
        return objectMapper.valueToTree(Map.of("suggestions", clean));
    }

    /** A tab is exactly 6 chars, each a digit or 'x'/'X'. */
    private static boolean isValidTab(String tab) {
        if (tab == null || tab.length() != 6) return false;
        for (char c : tab.toCharArray()) {
            if (!(Character.isDigit(c) || c == 'x' || c == 'X')) return false;
        }
        return true;
    }

    private static String orEmpty(String s) { return s == null ? "" : s.trim(); }
}
