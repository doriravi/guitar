package com.guitarreach.api.controller;

import com.guitarreach.api.dto.request.CreateSubscriptionRequest;
import com.guitarreach.api.dto.response.SubscriptionResponse;
import com.guitarreach.api.service.SubscriptionService;
import jakarta.validation.Valid;
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

    @GetMapping("/me")
    public ResponseEntity<SubscriptionResponse> getSubscription(
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(subscriptionService.getSubscription(userDetails.getUsername()));
    }

    @PostMapping("/checkout")
    public ResponseEntity<Map<String, String>> createCheckout(
            @AuthenticationPrincipal UserDetails userDetails,
            @Valid @RequestBody CreateSubscriptionRequest req) throws Exception {
        String url = subscriptionService.createCheckoutSession(userDetails.getUsername(), req);
        return ResponseEntity.ok(Map.of("url", url));
    }

    @PostMapping("/cancel")
    public ResponseEntity<Void> cancel(@AuthenticationPrincipal UserDetails userDetails) throws Exception {
        subscriptionService.cancelSubscription(userDetails.getUsername());
        return ResponseEntity.noContent().build();
    }
}
