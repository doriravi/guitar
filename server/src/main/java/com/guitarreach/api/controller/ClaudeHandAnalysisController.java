package com.guitarreach.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Claude-vision hand analysis for the hand-profile setup wizard.
 *
 * The frontend used to call the Anthropic API directly with a VITE_-exposed
 * key — unshippable, since anything in the client bundle is public. This
 * endpoint moves that call server-side: the browser POSTs the captured photo
 * (base64 JPEG) and gets back the strict-JSON biomechanics report; the key
 * stays in the backend env (ANTHROPIC_API_KEY, same one ExplainController and
 * AdvisorController use).
 *
 * Same graceful-degradation contract as the other AI controllers: 503 when
 * the key isn't configured.
 */
@RestController
@RequestMapping("/api/analyze-hand/claude")
public class ClaudeHandAnalysisController {

    @Value("${anthropic.api.key:}")
    private String anthropicApiKey;

    private static final String ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
    private static final String MODEL = "claude-haiku-4-5";

    private static final String SYSTEM_PROMPT =
        "You are a guitar biomechanics expert. Analyze this left hand photo and estimate the player's finger gap measurements and chord reach capability.\n\n" +
        "Measure the visible spread distances between adjacent fingertips when the hand is splayed:\n" +
        "- thumb_to_index_cm: distance in cm between thumb tip and index tip (range 8-18)\n" +
        "- index_to_middle_cm: distance in cm between index and middle fingertips (range 4-12)\n" +
        "- middle_to_ring_cm: distance in cm between middle and ring fingertips (range 3-10)\n" +
        "- ring_to_pinky_cm: distance in cm between ring and pinky fingertips (range 5-14)\n\n" +
        "Also assess each finger individually:\n" +
        "- thumb: length category (Short/Medium/Long), flexibility (Low/Medium/High), note about guitar technique impact\n" +
        "- index: length (Short/Medium/Long), straightness (Curved/Straight), barre chord suitability\n" +
        "- middle: length (Short/Medium/Long), independence from ring finger (Low/Medium/High)\n" +
        "- ring: length (Short/Medium/Long), independence (Low/Medium/High)\n" +
        "- pinky: length (Short/Medium/Long), reach (Weak/Moderate/Strong), note about 4th finger use\n\n" +
        "Grades: 1=Open chords, 2=Drop-2/jazz voicings, 3=Full barre/minor9ths, 4=Hendrix thumb/5-fret stretches, 5=Holdsworth wide voicings.\n\n" +
        "Return ONLY valid JSON, no markdown fences, no extra text. Keep all description strings under 60 chars:\n" +
        "{\"measurements\":{\"thumb_to_index_cm\":13.5,\"index_to_middle_cm\":7.5,\"middle_to_ring_cm\":6.0,\"ring_to_pinky_cm\":9.5}," +
        "\"biomechanical_profile\":{\"absolute_span_assessment\":\"Small|Medium|Large\",\"inferred_flexibility_splay\":\"Low|Medium|High\"," +
        "\"fingers\":{\"thumb\":{\"length\":\"Short|Medium|Long\",\"flexibility\":\"Low|Medium|High\",\"note\":\"<15 words>\"}," +
        "\"index\":{\"length\":\"Short|Medium|Long\",\"straightness\":\"Curved|Straight\",\"note\":\"<15 words>\"}," +
        "\"middle\":{\"length\":\"Short|Medium|Long\",\"independence\":\"Low|Medium|High\",\"note\":\"<15 words>\"}," +
        "\"ring\":{\"length\":\"Short|Medium|Long\",\"independence\":\"Low|Medium|High\",\"note\":\"<15 words>\"}," +
        "\"pinky\":{\"length\":\"Short|Medium|Long\",\"reach\":\"Weak|Moderate|Strong\",\"note\":\"<15 words>\"}}}," +
        "\"chord_capability_grades\":[{\"grade_level\":\"Grade 1\",\"status\":\"Optimal|Challenging|Structurally Restricted\",\"supported_voicings\":[\"chord1\",\"chord2\"],\"anatomical_reasoning\":\"<20 words>\"}," +
        "{\"grade_level\":\"Grade 2\",\"status\":\"Optimal|Challenging|Structurally Restricted\",\"supported_voicings\":[\"chord1\",\"chord2\"],\"anatomical_reasoning\":\"<20 words>\"}," +
        "{\"grade_level\":\"Grade 3\",\"status\":\"Optimal|Challenging|Structurally Restricted\",\"supported_voicings\":[\"chord1\",\"chord2\"],\"anatomical_reasoning\":\"<20 words>\"}," +
        "{\"grade_level\":\"Grade 4\",\"status\":\"Optimal|Challenging|Structurally Restricted\",\"supported_voicings\":[\"chord1\",\"chord2\"],\"anatomical_reasoning\":\"<20 words>\"}," +
        "{\"grade_level\":\"Grade 5\",\"status\":\"Optimal|Challenging|Structurally Restricted\",\"supported_voicings\":[\"chord1\",\"chord2\"],\"anatomical_reasoning\":\"<20 words>\"}]," +
        "\"recommended_focus\":\"<25 words>\"}";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping
    public ResponseEntity<String> analyze(@RequestBody Map<String, String> body) {
        if (anthropicApiKey == null || anthropicApiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"AI hand analysis not configured on server\"}");
        }

        String imageB64 = body.get("imageB64");
        if (imageB64 == null || imageB64.isBlank()) {
            return ResponseEntity.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":\"imageB64 is required\"}");
        }

        try {
            // Build the Messages API payload with Jackson so all strings are escaped.
            String payload = objectMapper.writeValueAsString(Map.of(
                "model", MODEL,
                "max_tokens", 3000,
                "system", SYSTEM_PROMPT,
                "messages", new Object[] {
                    Map.of("role", "user", "content", new Object[] {
                        Map.of("type", "image", "source", Map.of(
                            "type", "base64",
                            "media_type", "image/jpeg",
                            "data", imageB64)),
                        Map.of("type", "text",
                            "text", "Analyze this hand photo and return the biomechanical JSON report."),
                    })
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

            String json = extractJsonObject(text);
            if (json == null) {
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"Model response contained no JSON report\"}");
            }

            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(json);

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
     * The model is told to return bare JSON, but guard against markdown fences
     * and stray prose: strip fences, then return the first balanced {...}
     * object, or null when none is found.
     */
    private static String extractJsonObject(String text) {
        if (text.startsWith("```")) {
            text = text.replaceAll("(?s)^```[a-z]*\\s*", "").replaceAll("```\\s*$", "").trim();
        }
        int start = text.indexOf('{');
        if (start == -1) return null;
        int depth = 0;
        for (int i = start; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return text.substring(start, i + 1);
        }
        return null;
    }
}
