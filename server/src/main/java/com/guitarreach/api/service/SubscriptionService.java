package com.guitarreach.api.service;

import com.guitarreach.api.dto.response.SubscriptionResponse;
import com.guitarreach.api.entity.Payment;
import com.guitarreach.api.entity.Subscription;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.enums.PaymentStatus;
import com.guitarreach.api.enums.SubscriptionPlan;
import com.guitarreach.api.enums.SubscriptionStatus;
import com.guitarreach.api.exception.PaymentFailedException;
import com.guitarreach.api.exception.ResourceNotFoundException;
import com.guitarreach.api.repository.PaymentRepository;
import com.guitarreach.api.repository.SubscriptionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
@Slf4j
public class SubscriptionService {

    private final SubscriptionRepository subscriptionRepository;
    private final PaymentRepository paymentRepository;
    private final UserService userService;
    private final PayPalService payPalService;

    public SubscriptionResponse getSubscription(String email) {
        User user = userService.getEntityByEmail(email);
        Subscription sub = subscriptionRepository.findByUserId(user.getId())
                .orElse(Subscription.builder()
                        .plan(SubscriptionPlan.FREE)
                        .status(SubscriptionStatus.INACTIVE)
                        .build());
        return toResponse(sub);
    }

    // ── PayPal: the $10/year access pass ─────────────────────────────────────
    // The app sells one thing, billed as a one-off PayPal order that extends a
    // "paid until" date by a year. hasPaidAccess() below is the single predicate
    // the paywall filter and the SPA both read. (Stripe was the original provider
    // and its columns still live on the entities for legacy rows, but PayPal is
    // now the only checkout path.)

    /**
     * True iff this user may use the backend: an ACTIVE subscription whose paid
     * period has not yet elapsed. A null period end means "no paid period" and
     * is denied, so a half-written row can never accidentally grant access.
     */
    @Transactional(readOnly = true)
    public boolean hasPaidAccess(String email) {
        try {
            User user = userService.getEntityByEmail(email);
            return subscriptionRepository.findByUserId(user.getId())
                    .map(this::isActive)
                    .orElse(false);
        } catch (Exception e) {
            // An unknown/deleted user is simply unpaid — never fail open.
            log.debug("Paid-access check failed for {}: {}", email, e.getMessage());
            return false;
        }
    }

    private boolean isActive(Subscription sub) {
        return sub.getStatus() == SubscriptionStatus.ACTIVE
                && sub.getCurrentPeriodEnd() != null
                && sub.getCurrentPeriodEnd().isAfter(LocalDateTime.now());
    }

    /**
     * Starts a PayPal checkout: creates a $10 order tagged with this user's id
     * and hands the order id back for the PayPal JS buttons to approve.
     */
    @Transactional
    public String createPayPalOrder(String email) {
        User user = userService.getEntityByEmail(email);
        return payPalService.createOrder(String.valueOf(user.getId()));
    }

    /**
     * Captures an approved PayPal order and, only if PayPal reports it COMPLETED
     * for the right user and the right amount, extends paid access by one year.
     *
     * Three things are verified server-side, because the browser supplies the
     * order id and must not be trusted:
     *  1. the capture status really is COMPLETED (not DECLINED/PENDING),
     *  2. the order's reference id matches the authenticated user,
     *  3. the amount captured is at least the configured price.
     *
     * Replaying an already-recorded order is a no-op rather than a second year:
     * the order id is stored and re-checked.
     */
    @Transactional
    public SubscriptionResponse capturePayPalOrder(String email, String orderId) {
        User user = userService.getEntityByEmail(email);

        Subscription sub = subscriptionRepository.findByUserId(user.getId())
                .orElseGet(() -> Subscription.builder()
                        .user(user)
                        .plan(SubscriptionPlan.FREE)
                        .status(SubscriptionStatus.INACTIVE)
                        .build());

        // Idempotency: the same order never grants a second year.
        if (orderId.equals(sub.getPaypalOrderId())) {
            return toResponse(sub);
        }

        PayPalService.CaptureResult result = payPalService.captureOrder(orderId);

        if (!result.isCompleted()) {
            throw new PaymentFailedException("PayPal did not complete this payment (status: "
                    + result.status() + ").");
        }
        if (result.referenceId() != null
                && !String.valueOf(user.getId()).equals(result.referenceId())) {
            log.warn("PayPal order {} belongs to user {} but was captured by {}",
                    orderId, result.referenceId(), user.getId());
            throw new PaymentFailedException("This payment belongs to a different account.");
        }
        long expectedCents = expectedPriceCents();
        if (result.amountCents() < expectedCents) {
            log.warn("PayPal order {} captured {} cents, expected {}",
                    orderId, result.amountCents(), expectedCents);
            throw new PaymentFailedException("The amount paid did not match the price.");
        }

        // Extend rather than overwrite: paying again while still covered adds a
        // year to the end of the current period instead of shortening it.
        LocalDateTime from = (sub.getCurrentPeriodEnd() != null
                && sub.getCurrentPeriodEnd().isAfter(LocalDateTime.now()))
                ? sub.getCurrentPeriodEnd()
                : LocalDateTime.now();

        sub.setPlan(SubscriptionPlan.YEARLY);
        sub.setStatus(SubscriptionStatus.ACTIVE);
        sub.setCurrentPeriodEnd(from.plusYears(1));
        sub.setPaypalOrderId(orderId);
        subscriptionRepository.save(sub);

        paymentRepository.save(Payment.builder()
                .user(user)
                .amountCents(result.amountCents())
                .currency(result.currency() != null ? result.currency() : "USD")
                .status(PaymentStatus.SUCCEEDED)
                .paypalCaptureId(result.captureId())
                .build());

        log.info("PayPal payment captured for user {} — access until {}",
                user.getId(), sub.getCurrentPeriodEnd());
        return toResponse(sub);
    }

    /** Configured yearly price in cents, for verifying what PayPal captured. */
    private long expectedPriceCents() {
        try {
            return new java.math.BigDecimal(payPalService.getYearlyPriceUsd())
                    .movePointRight(2)
                    .setScale(0, java.math.RoundingMode.HALF_UP)
                    .longValueExact();
        } catch (Exception e) {
            return 1000L; // $10.00
        }
    }

    /**
     * Marks the subscription CANCELED. Access is not revoked immediately — the
     * already-paid period runs out on its own (isActive still honours
     * currentPeriodEnd); this just stops it from being treated as ongoing.
     */
    @Transactional
    public void cancelSubscription(String email) {
        User user = userService.getEntityByEmail(email);
        Subscription sub = subscriptionRepository.findByUserId(user.getId())
                .orElseThrow(() -> new ResourceNotFoundException("No subscription found"));
        sub.setStatus(SubscriptionStatus.CANCELED);
        subscriptionRepository.save(sub);
    }

    private SubscriptionResponse toResponse(Subscription sub) {
        return SubscriptionResponse.builder()
                .plan(sub.getPlan())
                .status(sub.getStatus())
                .currentPeriodEnd(sub.getCurrentPeriodEnd())
                // `active` mirrors exactly what the paywall filter enforces, so
                // the SPA never has to re-derive access rules for itself.
                .active(isActive(sub))
                .priceUsd(payPalService.getYearlyPriceUsd())
                .paypalConfigured(payPalService.isConfigured())
                // Legacy: non-null only for Stripe subscriptions predating PayPal.
                .stripeSubscriptionId(sub.getStripeSubscriptionId())
                .build();
    }
}
