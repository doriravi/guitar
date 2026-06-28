package com.guitarreach.api.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * Proxies guitar-audio uploads to the local Python transcription sidecar
 * (tab-service/, which wraps fingerstyle-tab-mcp) and returns its JSON
 * ({ ascii, bpm, events:[{string,fret,...}], chords }) unchanged.
 *
 * Mirrors {@link HandAnalysisController}: the heavy ML work lives in an external
 * service; this controller just forwards and degrades gracefully (503) when the
 * service URL is not configured.
 */
@RestController
@RequestMapping("/api/tab")
public class TabTranscriptionController {

    @Value("${tab.service.url:}")
    private String tabServiceUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping("/transcribe")
    public ResponseEntity<String> transcribe(
            @RequestParam(value = "audio", required = false) MultipartFile audio,
            @RequestParam(value = "youtube_url", required = false) String youtubeUrl,
            @RequestParam(value = "duration_seconds", required = false) Double durationSeconds,
            @RequestParam(value = "start_seconds", required = false) Double startSeconds) {

        if (tabServiceUrl == null || tabServiceUrl.isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"Tab transcription service not configured on server\"}");
        }

        boolean hasUrl = youtubeUrl != null && !youtubeUrl.isBlank();
        boolean hasFile = audio != null && !audio.isEmpty();

        if (!hasUrl && !hasFile) {
            return ResponseEntity.badRequest()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"an audio file or a youtube_url is required\"}");
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            if (hasFile) {
                // Preserve the original filename so the sidecar can validate the extension.
                String filename = audio.getOriginalFilename() != null ? audio.getOriginalFilename() : "audio.wav";
                ByteArrayResource filePart = new ByteArrayResource(audio.getBytes()) {
                    @Override
                    public String getFilename() {
                        return filename;
                    }
                };
                body.add("audio", filePart);
            }
            if (hasUrl) body.add("youtube_url", youtubeUrl.trim());
            if (durationSeconds != null) body.add("duration_seconds", durationSeconds);
            if (startSeconds != null) body.add("start_seconds", startSeconds);

            HttpEntity<MultiValueMap<String, Object>> req = new HttpEntity<>(body, headers);

            ResponseEntity<String> resp = restTemplate.postForEntity(
                    tabServiceUrl + "/transcribe", req, String.class);

            return ResponseEntity.status(resp.getStatusCode())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(resp.getBody());

        } catch (HttpClientErrorException | HttpServerErrorException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"Tab service error " + e.getStatusCode() + ": "
                            + e.getResponseBodyAsString().replace("\"", "'") + "\"}");
        } catch (ResourceAccessException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"Tab transcription service unreachable\"}");
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"Could not read uploaded audio\"}");
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage().replace("\"", "'") : "unknown error";
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"" + msg + "\"}");
        }
    }
}
