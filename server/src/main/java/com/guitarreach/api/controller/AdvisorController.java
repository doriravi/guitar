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
 * Floating AI advisor — a multi-turn music-theory + guitar consultant that also
 * knows this app (Guitar Reach).
 *
 * The frontend sends the running chat history plus a snapshot of what the user is
 * currently doing (active tab, hand profile, current composition). We forward the
 * conversation to Claude with a system prompt that combines: (1) music theory &
 * guitar expertise, (2) knowledge of this app's features, and (3) awareness that
 * the player has short fingers / low flexibility, so advice must be reach-aware.
 *
 * Mirrors ExplainController / ComposeController: raw HTTP to the Anthropic
 * Messages API and the same graceful-degradation contract — 503 when the key is
 * not configured, so the frontend widget can show an "unavailable" note.
 */
@RestController
@RequestMapping("/api/advise")
public class AdvisorController {

    @Value("${anthropic.api.key:}")
    private String anthropicApiKey;

    private static final String ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
    private static final String MODEL = "claude-sonnet-4-6";

    private static final String SYSTEM_PROMPT =
        "You are the AI Advisor inside Guitar Reach, a web app that helps guitar players — especially " +
        "those with short fingers and low flexibility — figure out which chords and shapes are physically " +
        "playable for their hand, and compose music that fits.\n\n" +
        "YOU ARE AN EXPERT in music theory, harmony, melody, songwriting, and guitar technique. Give " +
        "practical, accurate, encouraging advice. When theory is involved, explain it simply.\n\n" +
        "YOU ALSO KNOW THIS APP and can guide the user through it. Its main areas:\n" +
        "- My Hand: measure finger reach; every difficulty score is personalized to the user's hand.\n" +
        "- Composer: a step editor to build songs beat-by-beat, with sheet music, a key selector, a " +
        "chord-progression inserter, and an 'Ask the expert' button. Difficulty 1-10 (10 = hardest stretch).\n" +
        "- Play / Scales / Chord Finder (in the menu): live fretboard, scale viewer, and chord voicing search.\n" +
        "- Chords / Triplets / Progressions: tables of shapes and sequences rated for the user's hand.\n" +
        "- Tuner, Listen (chord detection), Audio -> Tab (transcribe a clip).\n\n" +
        "BE REACH-AWARE: when the user's hand profile is provided, tailor suggestions to it — prefer " +
        "compact, low-fret, few-finger shapes for small hands, and respect their difficulty ceiling. If " +
        "you suggest a specific chord shape, you may give its tab as 6 characters (low-E A D G B high-e, " +
        "digit = fret, x = muted).\n\n" +
        "STYLE: conversational and concise. Use short paragraphs or bullet lists. Plain text (light " +
        "markdown is fine). Aim for under 180 words unless the user asks for depth. If asked something " +
        "unrelated to music, guitar, or this app, gently steer back.";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping
    public ResponseEntity<String> advise(@RequestBody Map<String, Object> body) {
        if (anthropicApiKey == null || anthropicApiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"AI advisor not configured on server\"}");
        }

        // Build the message list. We prepend a synthetic context turn so the model
        // knows the user's current situation without polluting the visible chat.
        List<Map<String, String>> messages = new ArrayList<>();
        String context = describeContext(body.get("context"));
        if (!context.isBlank()) {
            messages.add(Map.of("role", "user",
                "content", "[App context for your reference — do not reply to this directly]\n" + context));
            messages.add(Map.of("role", "assistant",
                "content", "Understood — I'll keep the user's current screen and hand profile in mind."));
        }

        Object historyObj = body.get("messages");
        if (historyObj instanceof List<?> history) {
            for (Object m : history) {
                if (m instanceof Map<?, ?> mm) {
                    String role = orEmpty(String.valueOf(mm.get("role")));
                    String content = orEmpty(String.valueOf(mm.get("content")));
                    if (content.isBlank()) continue;
                    // Only user/assistant roles are valid in the Messages API.
                    if (!role.equals("user") && !role.equals("assistant")) role = "user";
                    messages.add(Map.of("role", role, "content", content));
                }
            }
        }

        if (messages.isEmpty()) {
            return ResponseEntity.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"messages is required\"}");
        }

        try {
            String payload = objectMapper.writeValueAsString(Map.of(
                "model", MODEL,
                "max_tokens", 800,
                "system", SYSTEM_PROMPT,
                "messages", messages
            ));

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("x-api-key", anthropicApiKey);
            headers.set("anthropic-version", "2023-06-01");
            HttpEntity<String> req = new HttpEntity<>(payload, headers);

            ResponseEntity<String> resp = restTemplate.postForEntity(ANTHROPIC_URL, req, String.class);

            JsonNode root = objectMapper.readTree(resp.getBody());
            String text = root.at("/content/0/text").asText("").trim();

            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(objectMapper.writeValueAsString(Map.of("reply", text)));

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

    /** Render the frontend's context snapshot into a compact description. */
    private String describeContext(Object ctxObj) {
        if (!(ctxObj instanceof Map<?, ?> c)) return "";
        StringBuilder sb = new StringBuilder();
        appendField(sb, "Current screen", c.get("tab"));
        appendField(sb, "UI language", c.get("lang"));

        Object hand = c.get("hand");
        if (hand instanceof Map<?, ?> h) {
            appendField(sb, "Hand ability", h.get("abilityLabel"));
            appendField(sb, "Recommended max difficulty (1-10)", h.get("recommendedMaxDifficulty"));
            appendField(sb, "Finger gaps (cm) thumb-index/index-middle/middle-ring/ring-little",
                join(h.get("thumbToIndex"), h.get("indexToMiddle"), h.get("middleToRing"), h.get("ringToLittle")));
        }

        Object comp = c.get("composition");
        if (comp instanceof Map<?, ?> cm) {
            appendField(sb, "Composition key", cm.get("key"));
            Object beats = cm.get("beats");
            if (beats instanceof List<?> bl && !bl.isEmpty()) {
                StringBuilder bd = new StringBuilder();
                int i = 1;
                for (Object b : bl) {
                    if (b instanceof Map<?, ?> bm) {
                        Object labelVal = bm.get("chordLabel");
                        Object tabVal = bm.get("tab");
                        String label = orEmpty(labelVal == null ? "" : String.valueOf(labelVal));
                        String tab = orEmpty(tabVal == null ? "" : String.valueOf(tabVal));
                        bd.append(i++).append('.').append(label.isBlank() ? "notes" : label)
                          .append(tab.isBlank() ? "" : "[" + tab + "]").append(' ');
                    }
                }
                appendField(sb, "Composition beats", bd.toString().trim());
            }
        }
        return sb.toString();
    }

    private static String join(Object... vals) {
        List<String> parts = new ArrayList<>();
        for (Object v : vals) {
            if (v == null) continue;
            String s = String.valueOf(v).trim();
            if (!s.isEmpty() && !"null".equals(s)) parts.add(s);
        }
        return String.join("/", parts);
    }

    private static void appendField(StringBuilder sb, String label, Object val) {
        if (val == null) return;
        String s = String.valueOf(val).trim();
        if (s.isEmpty() || "null".equals(s)) return;
        sb.append(label).append(": ").append(s).append("\n");
    }

    private static String orEmpty(String s) { return s == null ? "" : s.trim(); }
}
