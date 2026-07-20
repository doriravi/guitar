package com.guitarreach.api.controller;

import com.guitarreach.api.dto.response.SubscriptionResponse;
import com.guitarreach.api.service.SubscriptionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/subscriptions")
@RequiredArgsConstructor
public class SubscriptionController {

    private final SubscriptionService subscriptionService;
    private final com.guitarreach.api.service.PayPalService payPalService;

    /** Public client id — safe to expose; the secret never leaves the server. */
    @org.springframework.beans.factory.annotation.Value("${paypal.client-id:}")
    private String payPalClientId;

    @GetMapping("/me")
    public ResponseEntity<SubscriptionResponse> getSubscription(
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(subscriptionService.getSubscription(userDetails.getUsername()));
    }

    /**
     * Public PayPal config the browser needs to load the PayPal JS SDK: the
     * CLIENT ID only (never the secret), plus price and whether checkout is
     * available at all. Unauthenticated so the pricing screen can render before
     * sign-in.
     */
    @GetMapping("/paypal/config")
    public ResponseEntity<Map<String, Object>> payPalConfig() {
        return ResponseEntity.ok(Map.of(
                "clientId", payPalService.isConfigured() ? payPalClientId : "",
                "configured", payPalService.isConfigured(),
                "priceUsd", payPalService.getYearlyPriceUsd(),
                "currency", "USD"
        ));
    }

    /**
     * Step 1 of the PayPal flow: create the $10/year order and return its id for
     * the PayPal JS buttons to approve in the browser.
     */
    @PostMapping("/paypal/order")
    public ResponseEntity<Map<String, String>> createPayPalOrder(
            @AuthenticationPrincipal UserDetails userDetails) {
        String orderId = subscriptionService.createPayPalOrder(userDetails.getUsername());
        return ResponseEntity.ok(Map.of("orderId", orderId));
    }

    /**
     * Step 2: capture the approved order. The server re-verifies status, owner
     * and amount with PayPal before granting a year of access, then returns the
     * updated subscription so the SPA can unlock immediately.
     */
    @PostMapping("/paypal/capture")
    public ResponseEntity<SubscriptionResponse> capturePayPalOrder(
            @AuthenticationPrincipal UserDetails userDetails,
            @RequestBody Map<String, String> body) {
        String orderId = body.get("orderId");
        if (orderId == null || orderId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(
                subscriptionService.capturePayPalOrder(userDetails.getUsername(), orderId));
    }

    @PostMapping("/cancel")
    public ResponseEntity<Void> cancel(@AuthenticationPrincipal UserDetails userDetails) {
        subscriptionService.cancelSubscription(userDetails.getUsername());
        return ResponseEntity.noContent().build();
    }
}
