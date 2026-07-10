package com.guitarreach.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fetches a REAL, human-made chord sheet (chords-over-lyrics) for a song, so the
 * frontend's "Copy real chords" can paste it into the lyrics. The browser cannot
 * read a cross-origin chord-sheet tab, so this proxy does the reading server-side.
 *
 * Source: Cifra Club (cifraclub.com.br) — a huge chord database that serves its
 * sheets as plain HTML and exposes an open search endpoint. Ultimate Guitar is
 * NOT used here: it 403s every non-browser client (bot protection), so it can
 * only ever be opened visually in the user's browser, never read.
 *
 * The sheet page is located via the search API, then the page's key ("Tom:"),
 * capo ("Capotraste na Nª casa") and the &lt;pre&gt; sheet block are extracted and
 * returned as plain text in the app's paste-able format:
 *
 *   TITLE Chords by ARTIST
 *   Key: X
 *   Capo: N
 *
 *   [chords over lyrics...]
 *
 * No configuration needed; failures degrade to 404 (no sheet) / 502 (source down).
 */
@RestController
@RequestMapping("/api/chordsheet")
public class ChordSheetController {

    private static final String SEARCH_URL = "https://solr.sscdn.co/cc/h2/?q=";
    private static final String PAGE_URL = "https://www.cifraclub.com.br/%s/%s/";
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    private static final Pattern PRE_RE = Pattern.compile("<pre>(.*?)</pre>", Pattern.DOTALL);
    private static final Pattern TOM_RE = Pattern.compile(
            "id=\"cifra_tom\".*?[Tt]om:\\s*(?:<[^>]+>\\s*)*([A-G][#b]?m?)", Pattern.DOTALL);
    private static final Pattern CAPO_RE = Pattern.compile(
            "Capotraste na\\s*(?:<[^>]+>\\s*)*(\\d+)", Pattern.DOTALL);

    private final ObjectMapper mapper = new ObjectMapper();
    private final RestTemplate restTemplate;

    public ChordSheetController() {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(8000);
        f.setReadTimeout(15000);
        this.restTemplate = new RestTemplate(f);
    }

    @GetMapping
    public ResponseEntity<?> fetch(@RequestParam String title,
                                   @RequestParam(required = false, defaultValue = "") String artist,
                                   @RequestParam(required = false, defaultValue = "0") int skip) {
        try {
            // 1) Search for the song. The endpoint answers JSONP: ({...}) — unwrap.
            String query = URLEncoder.encode((title + " " + artist).trim(), StandardCharsets.UTF_8);
            String raw = get(SEARCH_URL + query);
            if (raw == null) return upstreamDown();
            raw = raw.trim();
            if (raw.startsWith("(") && raw.endsWith(")")) raw = raw.substring(1, raw.length() - 1);

            // Docs: m=title, a=artist, d=artist slug, u=song slug, t="2"=chord sheet.
            // `skip` lets the client ask for the 2nd, 3rd… ranked sheet ("try another
            // version") instead of always the top hit. matchCount is how many sheets
            // exist total, so the client can grey out the button at the last one.
            JsonNode docs = mapper.readTree(raw).at("/response/docs");
            JsonNode hit = null;
            int matchCount = 0;
            int skipRemaining = Math.max(0, skip);
            for (JsonNode d : docs) {
                boolean isSheet = d.path("t").asText("2").equals("2");
                if (isSheet && !d.path("d").asText("").isBlank() && !d.path("u").asText("").isBlank()) {
                    matchCount++;
                    if (hit == null) {
                        if (skipRemaining > 0) { skipRemaining--; continue; }
                        hit = d; // first sheet AT OR AFTER the requested skip offset
                    }
                }
            }
            if (hit == null) {
                // Ran past the last result: report NOT_FOUND so the client can stop
                // advancing (and, for skip>0, keep the version it already had).
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "No chord sheet found for this song"));
            }

            // 2) Fetch the sheet page and pull key / capo / the <pre> sheet block.
            String pageUrl = String.format(PAGE_URL, hit.path("d").asText(), hit.path("u").asText());
            String html = get(pageUrl);
            if (html == null) return upstreamDown();

            Matcher pre = PRE_RE.matcher(html);
            if (!pre.find()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "The chord sheet page had no readable sheet"));
            }
            String sheet = unescapeHtml(pre.group(1).replaceAll("<[^>]+>", "")).trim();

            Matcher tom = TOM_RE.matcher(html);
            String key = tom.find() ? tom.group(1) : "";
            Matcher capoM = CAPO_RE.matcher(html);
            int capo = capoM.find() ? Integer.parseInt(capoM.group(1)) : 0;

            StringBuilder text = new StringBuilder();
            text.append(hit.path("m").asText(title)).append(" Chords by ")
                    .append(hit.path("a").asText(artist)).append('\n');
            if (!key.isBlank()) text.append("Key: ").append(key).append('\n');
            if (capo > 0) text.append("Capo: ").append(capo).append('\n');
            text.append('\n').append(sheet).append('\n');

            // `version`/`matchCount` let the UI show "version 2 of 5" and disable
            // "try another version" when it's already showing the last one.
            return ResponseEntity.ok(Map.of(
                    "url", pageUrl,
                    "text", text.toString(),
                    "version", Math.min(skip, matchCount - 1),
                    "matchCount", matchCount));

        } catch (ResourceAccessException e) {
            return upstreamDown();
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "unknown error";
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("error", "Chord sheet lookup failed: " + msg));
        }
    }

    private String get(String url) {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.USER_AGENT, USER_AGENT);
        headers.set(HttpHeaders.ACCEPT, "text/html,application/json;q=0.9,*/*;q=0.8");
        ResponseEntity<String> resp =
                restTemplate.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), String.class);
        return resp.getStatusCode().is2xxSuccessful() ? resp.getBody() : null;
    }

    private static ResponseEntity<Map<String, String>> upstreamDown() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "The chord sheet source is unreachable right now"));
    }

    // The sheet sits inside HTML, so entity-escape the few entities that occur in
    // lyric text. &amp; must be unescaped last.
    private static String unescapeHtml(String s) {
        return s.replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&#039;", "'")
                .replace("&apos;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&");
    }
}
