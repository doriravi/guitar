package com.guitarreach.api.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@RestController
@RequestMapping("/api/analyze-hand")
public class HandAnalysisController {

    @Value("${gemini.api.key:#{null}}")
    private String geminiApiKey;

    private static final String GEMINI_URL =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=";

    private static final String SYSTEM_PROMPT =
        "You are an expert biomechanical analysis agent specializing in guitar ergonomics. " +
        "Analyze the photograph of the user's left hand and determine their physiological capacity " +
        "for executing various guitar chord voicings.\n\n" +
        "Evaluate: absolute span (index to pinky), thumb length/pivot, index finger linearity, " +
        "middle/ring lateral splay, pinky reach and arch.\n\n" +
        "Grade levels:\n" +
        "- Grade 1 (Fundamentals): Open chords, basic triads.\n" +
        "- Grade 2 (Clustered Complexity): High lateral splay, low span. Drop-2 jazz voicings, diminished inversions.\n" +
        "- Grade 3 (The Standard): Moderate span, linear index. 6-string barres, minor 9ths.\n" +
        "- Grade 4 (Brute Force): Large span, long thumb. 5-fret power chords, Hendrix thumb chords.\n" +
        "- Grade 5 (Extended Range): Maximum span AND high splay/pinky. Wide add9, Holdsworth voicings.\n\n" +
        "Return ONLY valid JSON (no markdown fences):\n" +
        "{\"biomechanical_profile\":{\"absolute_span_assessment\":\"Small|Medium|Large\"," +
        "\"inferred_flexibility_splay\":\"Low|Medium|High\"," +
        "\"digit_analysis\":{\"thumb\":\"...\",\"index\":\"...\",\"middle_ring_cluster\":\"...\",\"pinky\":\"...\"}}," +
        "\"chord_capability_grades\":[{\"grade_level\":\"Grade 1\",\"status\":\"Optimal|Challenging|Structurally Restricted\"," +
        "\"supported_voicings\":[\"...\"],\"anatomical_reasoning\":\"...\"}]," +
        "\"recommended_focus\":\"...\"}";

    @PostMapping
    public ResponseEntity<String> analyze(@RequestBody Map<String, String> body) {
        if (geminiApiKey == null || geminiApiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body("{\"error\":\"Gemini API key not configured\"}");
        }

        String imageB64 = body.get("imageB64");
        if (imageB64 == null || imageB64.isBlank()) {
            return ResponseEntity.badRequest().body("{\"error\":\"imageB64 is required\"}");
        }

        String payload = """
            {
              "contents": [{
                "parts": [
                  {"text": %s},
                  {"inline_data": {"mime_type": "image/jpeg", "data": "%s"}}
                ]
              }]
            }
            """.formatted(
                com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                    .valueToTree(SYSTEM_PROMPT).toString(),
                imageB64
            );

        try {
            RestTemplate rt = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<String> req = new HttpEntity<>(payload, headers);

            ResponseEntity<String> resp = rt.postForEntity(
                GEMINI_URL + geminiApiKey, req, String.class);

            // Extract the text field from Gemini's response envelope
            com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
            com.fasterxml.jackson.databind.JsonNode root = om.readTree(resp.getBody());
            String text = root.at("/candidates/0/content/parts/0/text").asText("").trim();

            // Strip markdown fences if present
            if (text.startsWith("```")) {
                text = text.replaceAll("^```[a-z]*\\n?", "").replaceAll("```$", "").trim();
            }

            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(text);

        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body("{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
        }
    }
}
