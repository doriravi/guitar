package com.guitarreach.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * On-demand, AI-generated explanations for the draggable guide avatar.
 *
 * The frontend sends the context of whatever the user dropped the guide on
 * (element text, tag/role, the tool/tab they're in, plus nearby labels). We ask
 * Gemini for one short, friendly, spoken-style sentence or two describing what
 * that control does — so the guide can explain ANY part of the app, not just the
 * hand-tagged pieces.
 *
 * Same graceful-degradation contract as HandAnalysisController: 503 when the
 * Gemini key isn't configured (the frontend then falls back to its own heuristic).
 */
@RestController
@RequestMapping("/api/explain")
public class ExplainController {

    @Value("${gemini.api.key:}")
    private String geminiApiKey;

    private static final String GEMINI_URL =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=";

    private static final String SYSTEM_PROMPT =
        "You are a friendly in-app guide for Guitar Reach, a web app that scores how hard guitar " +
        "chords are for a player's specific hand size (short fingers, low flexibility). A user pointed " +
        "at a UI element and wants to know what it does.\n\n" +
        "Given the element context below, reply with ONE or TWO short sentences, in plain spoken English, " +
        "addressed to the user ('This lets you…', 'Tap this to…'). Be concrete about the action. " +
        "No markdown, no quotes, no preamble — just the explanation, ready to be read aloud. " +
        "Keep it under 45 words. If the element is a guitar chord name, explain it's that chord and that " +
        "the app rates how hard it is for their hand.";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping
    public ResponseEntity<String> explain(@RequestBody Map<String, String> body) {
        if (geminiApiKey == null || geminiApiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"AI explanations not configured on server\"}");
        }

        String label = orEmpty(body.get("label"));
        String tag = orEmpty(body.get("tag"));
        String role = orEmpty(body.get("role"));
        String tab = orEmpty(body.get("tab"));
        String context = orEmpty(body.get("context"));

        if (label.isBlank() && tag.isBlank()) {
            return ResponseEntity.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"label or tag is required\"}");
        }

        String userPrompt =
            "Current tool/tab: " + (tab.isBlank() ? "unknown" : tab) + "\n" +
            "Element type: " + tag + (role.isBlank() ? "" : " (role " + role + ")") + "\n" +
            "Element text/label: " + (label.isBlank() ? "(none)" : label) + "\n" +
            "Nearby context: " + (context.isBlank() ? "(none)" : context);

        try {
            String full = SYSTEM_PROMPT + "\n\n" + userPrompt;
            String promptJson = objectMapper.writeValueAsString(full);

            String payload = "{\"contents\":[{\"parts\":[{\"text\":" + promptJson + "}]}],"
                + "\"generationConfig\":{\"temperature\":0.4,\"maxOutputTokens\":120}}";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<String> req = new HttpEntity<>(payload, headers);

            ResponseEntity<String> resp = restTemplate.postForEntity(
                GEMINI_URL + geminiApiKey, req, String.class);

            JsonNode root = objectMapper.readTree(resp.getBody());
            String text = root.at("/candidates/0/content/parts/0/text").asText("").trim();
            if (text.startsWith("```")) {
                text = text.replaceAll("(?s)^```[a-z]*\\s*", "").replaceAll("```\\s*$", "").trim();
            }
            // Return as JSON { explanation }
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(objectMapper.writeValueAsString(Map.of("explanation", text)));

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

    private static String orEmpty(String s) { return s == null ? "" : s.trim(); }
}
