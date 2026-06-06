package com.guitarreach.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@RestController
@RequestMapping("/api/analyze-hand")
public class HandAnalysisController {

    @Value("${gemini.api.key:}")
    private String geminiApiKey;

    private static final String GEMINI_URL =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=";

    private static final String SYSTEM_PROMPT =
        "You are an expert biomechanical analysis agent specializing in guitar ergonomics. " +
        "Analyze the photograph of the user's left hand and determine their physiological capacity " +
        "for executing various guitar chord voicings.\n\n" +
        "Evaluate: absolute span (index to pinky), thumb length/pivot, index finger linearity, " +
        "middle/ring lateral splay, pinky reach and arch.\n\n" +
        "Grade levels:\n" +
        "Grade 1 (Fundamentals): Open chords, basic triads.\n" +
        "Grade 2 (Clustered Complexity): High lateral splay, low span. Drop-2 jazz, diminished inversions.\n" +
        "Grade 3 (The Standard): Moderate span, linear index. 6-string barres, minor 9ths.\n" +
        "Grade 4 (Brute Force): Large span, long thumb. 5-fret power chords, Hendrix thumb chords.\n" +
        "Grade 5 (Extended Range): Maximum span AND high splay. Wide add9, Holdsworth voicings.\n\n" +
        "Return ONLY valid JSON with no markdown fences, no extra text, exactly this structure:\n" +
        "{\"biomechanical_profile\":{\"absolute_span_assessment\":\"Small\",\"inferred_flexibility_splay\":\"Medium\"," +
        "\"digit_analysis\":{\"thumb\":\"...\",\"index\":\"...\",\"middle_ring_cluster\":\"...\",\"pinky\":\"...\"}}," +
        "\"chord_capability_grades\":[{\"grade_level\":\"Grade 1\",\"status\":\"Optimal\"," +
        "\"supported_voicings\":[\"Open G\"],\"anatomical_reasoning\":\"...\"}]," +
        "\"recommended_focus\":\"...\"}";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping
    public ResponseEntity<String> analyze(@RequestBody Map<String, String> body) {
        if (geminiApiKey == null || geminiApiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body("{\"error\":\"Gemini API key not configured on server\"}");
        }

        String imageB64 = body.get("imageB64");
        if (imageB64 == null || imageB64.isBlank()) {
            return ResponseEntity.badRequest().body("{\"error\":\"imageB64 is required\"}");
        }

        try {
            String promptJson = objectMapper.writeValueAsString(SYSTEM_PROMPT);

            String payload = "{"
                + "\"contents\":[{"
                + "\"parts\":["
                + "{\"text\":" + promptJson + "},"
                + "{\"inline_data\":{\"mime_type\":\"image/jpeg\",\"data\":\"" + imageB64 + "\"}}"
                + "]}]}";

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

            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(text);

        } catch (HttpClientErrorException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body("{\"error\":\"Gemini API error " + e.getStatusCode() + ": " + e.getResponseBodyAsString().replace("\"", "'") + "\"}");
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
        }
    }
}
