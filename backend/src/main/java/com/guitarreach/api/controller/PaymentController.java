package com.guitarreach.api.controller;

import com.guitarreach.api.service.SubscriptionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/payments")
@RequiredArgsConstructor
@Slf4j
public class PaymentController {

    private final SubscriptionService subscriptionService;

    /**
     * Stripe webhook — authenticated by Stripe-Signature header, not by JWT.
     * This endpoint must be excluded from CSRF and JWT filters (configured in SecurityConfig).
     * The raw request body must be passed unmodified to signature validation.
     */
    @PostMapping("/webhook")
    public ResponseEntity<Void> webhook(
            @RequestBody String payload,
            @RequestHeader("Stripe-Signature") String sigHeader) {
        try {
            subscriptionService.handleWebhookEvent(payload, sigHeader);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("Webhook error: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }
    }
}
