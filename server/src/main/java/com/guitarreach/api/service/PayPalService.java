package com.guitarreach.api.service;

import com.guitarreach.api.exception.ProviderNotConfiguredException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Thin PayPal Orders v2 client — the app sells ONE thing: a $10/year access pass,
 * charged as a plain one-off order rather than a PayPal subscription plan. That
 * keeps setup to two env vars (client id + secret) with no billing-plan objects
 * to create in the PayPal dashboard, and makes access a simple "paid until"
 * date we control (see SubscriptionService).
 *
 * Deliberately hand-rolled over RestTemplate rather than pulling in the PayPal
 * SDK: we need exactly two calls (create order, capture order) plus OAuth, and
 * this matches how the other outbound integrations here are written.
 *
 * Graceful degradation, same contract as Gemini/Claude/tab-service: with no
 * credentials configured, {@link #isConfigured()} is false and every call throws
 * ProviderNotConfiguredException → 503, so a dev machine without PayPal keys
 * runs fine and the UI can disable the button.
 */
@Service
@Slf4j
public class PayPalService {

    /** Live vs sandbox is chosen purely by base URL, from the `paypal.mode` property. */
    private static final String LIVE_BASE = "https://api-m.paypal.com";
    private static final String SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${paypal.client-id:}")
    private String clientId;

    @Value("${paypal.client-secret:}")
    private String clientSecret;

    @Value("${paypal.mode:sandbox}")
    private String mode;

    @Value("${paypal.price.yearly-usd:10.00}")
    private String yearlyPriceUsd;

    /** Cached OAuth token — PayPal tokens last ~9h; we refresh a minute early. */
    private volatile String cachedToken;
    private volatile Instant cachedTokenExpiry = Instant.EPOCH;

    public boolean isConfigured() {
        return StringUtils.hasText(clientId) && StringUtils.hasText(clientSecret);
    }

    public String getYearlyPriceUsd() {
        return yearlyPriceUsd;
    }

    private String baseUrl() {
        return "live".equalsIgnoreCase(mode) ? LIVE_BASE : SANDBOX_BASE;
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw new ProviderNotConfiguredException(
                    "PayPal is not configured on this server (set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET).");
        }
    }

    /**
     * Client-credentials OAuth token, cached until shortly before it expires.
     */
    private synchronized String accessToken() {
        requireConfigured();
        if (cachedToken != null && Instant.now().isBefore(cachedTokenExpiry)) {
            return cachedToken;
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(clientId, clientSecret);
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        HttpEntity<String> req = new HttpEntity<>("grant_type=client_credentials", headers);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = restTemplate.postForObject(
                baseUrl() + "/v1/oauth2/token", req, Map.class);

        if (body == null || body.get("access_token") == null) {
            throw new IllegalStateException("PayPal returned no access token");
        }
        cachedToken = String.valueOf(body.get("access_token"));
        long expiresIn = body.get("expires_in") instanceof Number n ? n.longValue() : 300L;
        cachedTokenExpiry = Instant.now().plusSeconds(Math.max(60, expiresIn - 60));
        return cachedToken;
    }

    private HttpHeaders jsonAuthHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken());
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    /**
     * Creates a $10 USD order for one year of access and returns its PayPal order
     * id. The browser hands this id to the PayPal JS buttons, which run the
     * approval flow; we then {@link #captureOrder} it server-side.
     *
     * @param referenceId our own reference (the user id) echoed back on capture,
     *                    so a captured order can never be attributed to the wrong
     *                    account even if the client lies about who it is.
     */
    @SuppressWarnings("unchecked")
    public String createOrder(String referenceId) {
        requireConfigured();

        Map<String, Object> payload = Map.of(
                "intent", "CAPTURE",
                "purchase_units", List.of(Map.of(
                        "reference_id", referenceId,
                        "description", "Guitar Reach — 1 year of full access",
                        "amount", Map.of(
                                "currency_code", "USD",
                                "value", yearlyPriceUsd
                        )
                ))
        );

        try {
            Map<String, Object> body = restTemplate.postForObject(
                    baseUrl() + "/v2/checkout/orders",
                    new HttpEntity<>(payload, jsonAuthHeaders()),
                    Map.class);
            if (body == null || body.get("id") == null) {
                throw new IllegalStateException("PayPal returned no order id");
            }
            return String.valueOf(body.get("id"));
        } catch (HttpClientErrorException e) {
            log.error("PayPal createOrder failed: {} {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new IllegalStateException("Could not start PayPal checkout");
        }
    }

    /**
     * Captures an approved order. Returns the parsed result so the caller can
     * verify the amount actually paid and record the transaction id — never trust
     * the client's word that a payment happened.
     */
    @SuppressWarnings("unchecked")
    public CaptureResult captureOrder(String orderId) {
        requireConfigured();
        try {
            Map<String, Object> body = restTemplate.postForObject(
                    baseUrl() + "/v2/checkout/orders/" + orderId + "/capture",
                    new HttpEntity<>(Map.of(), jsonAuthHeaders()),
                    Map.class);
            return parseCapture(body);
        } catch (HttpClientErrorException e) {
            // A 422 UNPROCESSABLE_ENTITY here usually means the order was already
            // captured (double-submit). Re-read it so an honest retry still
            // resolves to the real, completed payment instead of an error.
            log.warn("PayPal capture failed ({}), re-reading order {}", e.getStatusCode(), orderId);
            return getOrder(orderId);
        }
    }

    /** Reads an existing order — used to reconcile a capture that raced/retried. */
    @SuppressWarnings("unchecked")
    public CaptureResult getOrder(String orderId) {
        requireConfigured();
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken());
            ResponseEntity<Map> resp = restTemplate.exchange(
                    baseUrl() + "/v2/checkout/orders/" + orderId,
                    HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            return parseCapture(resp.getBody());
        } catch (HttpClientErrorException e) {
            log.error("PayPal getOrder failed: {} {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new IllegalStateException("Could not verify the PayPal payment");
        }
    }

    /**
     * Pulls the fields we care about out of an order/capture response. PayPal
     * nests the captured amount under purchase_units[0].payments.captures[0];
     * we read it defensively because a failed capture omits those nodes.
     */
    @SuppressWarnings("unchecked")
    private CaptureResult parseCapture(Map<String, Object> body) {
        if (body == null) throw new IllegalStateException("Empty PayPal response");

        String status = String.valueOf(body.getOrDefault("status", "UNKNOWN"));
        String referenceId = null;
        String captureId = null;
        String currency = null;
        long amountCents = 0L;

        Object units = body.get("purchase_units");
        if (units instanceof List<?> unitList && !unitList.isEmpty()
                && unitList.get(0) instanceof Map<?, ?> unit) {
            Object ref = unit.get("reference_id");
            if (ref != null) referenceId = String.valueOf(ref);

            if (unit.get("payments") instanceof Map<?, ?> payments
                    && payments.get("captures") instanceof List<?> captures
                    && !captures.isEmpty()
                    && captures.get(0) instanceof Map<?, ?> capture) {
                captureId = String.valueOf(capture.get("id"));
                // The capture carries its OWN status; an order can read COMPLETED
                // while an individual capture is DECLINED, so prefer the capture's.
                if (capture.get("status") != null) status = String.valueOf(capture.get("status"));
                if (capture.get("amount") instanceof Map<?, ?> amt) {
                    currency = String.valueOf(amt.get("currency_code"));
                    amountCents = toCents(String.valueOf(amt.get("value")));
                }
            }
        }

        return new CaptureResult(status, referenceId, captureId, amountCents, currency);
    }

    /** "10.00" → 1000. Parsed as a decimal to dodge float rounding. */
    private static long toCents(String value) {
        try {
            return new java.math.BigDecimal(value)
                    .movePointRight(2)
                    .setScale(0, java.math.RoundingMode.HALF_UP)
                    .longValueExact();
        } catch (Exception e) {
            return 0L;
        }
    }

    /**
     * @param status      PayPal capture status; only "COMPLETED" grants access
     * @param referenceId the reference we set at create time (our user id)
     * @param captureId   PayPal's transaction id, stored on the Payment row
     * @param amountCents amount actually captured, verified against our price
     */
    public record CaptureResult(String status, String referenceId, String captureId,
                                long amountCents, String currency) {
        public boolean isCompleted() {
            return "COMPLETED".equalsIgnoreCase(status);
        }
    }
}
