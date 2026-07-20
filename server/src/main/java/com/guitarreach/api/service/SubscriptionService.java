package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.CreateSubscriptionRequest;
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
import com.stripe.exception.StripeException;
import com.stripe.model.Event;
import com.stripe.model.EventDataObjectDeserializer;
import com.stripe.model.Invoice;
import com.stripe.model.StripeObject;
import com.stripe.model.checkout.Session;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class SubscriptionService {

    private final SubscriptionRepository subscriptionRepository;
    private final PaymentRepository paymentRepository;
    private final UserService userService;
    private final StripeService stripeService;
    private final PayPalService payPalService;

    @Value("${stripe.price.monthly}")
    private String monthlyPriceId;

    @Value("${stripe.price.yearly}")
    private String yearlyPriceId;

    @Value("${app.frontend.url}")
    private String frontendUrl;

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
    // the paywall filter and the SPA both read.

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

    @Transactional
    public String createCheckoutSession(String email, CreateSubscriptionRequest req) throws StripeException {
        User user = userService.getEntityByEmail(email);

        Subscription sub = subscriptionRepository.findByUserId(user.getId())
                .orElse(Subscription.builder().user(user).plan(SubscriptionPlan.FREE).status(SubscriptionStatus.INACTIVE).build());

        if (sub.getStripeCustomerId() == null) {
            String customerId = stripeService.createOrGetCustomer(user.getEmail(), user.getName());
            sub.setStripeCustomerId(customerId);
            subscriptionRepository.save(sub);
        }

        // Select the Stripe price for the requested plan. FREE (or a null plan)
        // has no checkout — treat it as monthly so an errant request still lands
        // on a valid price rather than an empty checkout.
        String priceId = req.getPlan() == SubscriptionPlan.YEARLY ? yearlyPriceId : monthlyPriceId;
        // The SPA reads ?checkout=success|cancel on load (AccountSettings) to show
        // a confirmation banner and refresh subscription status.
        return stripeService.createCheckoutSession(
                sub.getStripeCustomerId(),
                priceId,
                frontendUrl + "/?checkout=success",
                frontendUrl + "/?checkout=cancel"
        );
    }

    @Transactional
    public void cancelSubscription(String email) throws StripeException {
        User user = userService.getEntityByEmail(email);
        Subscription sub = subscriptionRepository.findByUserId(user.getId())
                .orElseThrow(() -> new ResourceNotFoundException("No subscription found"));
        if (sub.getStripeSubscriptionId() != null) {
            stripeService.cancelSubscription(sub.getStripeSubscriptionId());
        }
        sub.setStatus(SubscriptionStatus.CANCELED);
        subscriptionRepository.save(sub);
    }

    @Transactional
    public void handleWebhookEvent(String payload, String sigHeader) throws StripeException {
        Event event = stripeService.constructWebhookEvent(payload, sigHeader);
        EventDataObjectDeserializer deserializer = event.getDataObjectDeserializer();
        Optional<StripeObject> stripeObject = deserializer.getObject();

        switch (event.getType()) {
            case "checkout.session.completed" -> stripeObject.ifPresent(obj -> {
                Session session = (Session) obj;
                handleCheckoutComplete(session);
            });
            case "invoice.payment_succeeded" -> stripeObject.ifPresent(obj -> {
                Invoice invoice = (Invoice) obj;
                handleInvoiceSucceeded(invoice);
            });
            case "invoice.payment_failed" -> stripeObject.ifPresent(obj -> {
                Invoice invoice = (Invoice) obj;
                handleInvoiceFailed(invoice);
            });
            case "customer.subscription.deleted" -> stripeObject.ifPresent(obj -> {
                com.stripe.model.Subscription stripeSub = (com.stripe.model.Subscription) obj;
                handleSubscriptionDeleted(stripeSub);
            });
            default -> log.debug("Unhandled Stripe event: {}", event.getType());
        }
    }

    private void handleCheckoutComplete(Session session) {
        subscriptionRepository.findByStripeCustomerId(session.getCustomer()).ifPresent(sub -> {
            sub.setStripeSubscriptionId(session.getSubscription());
            sub.setStatus(SubscriptionStatus.ACTIVE);
            sub.setPlan(resolvePlanFromSubscription(session.getSubscription()));
            subscriptionRepository.save(sub);

            Payment payment = Payment.builder()
                    .user(sub.getUser())
                    .amountCents(session.getAmountTotal())
                    .currency(session.getCurrency())
                    .status(PaymentStatus.SUCCEEDED)
                    .stripePaymentIntentId(session.getPaymentIntent())
                    .build();
            paymentRepository.save(payment);
        });
    }

    /**
     * Maps a Stripe subscription to our plan enum by comparing its billed price
     * against the configured monthly/yearly price IDs. Falls back to MONTHLY if
     * the price can't be read (e.g. Stripe API hiccup) so the user is still
     * marked Premium rather than left on FREE after a successful payment.
     */
    private SubscriptionPlan resolvePlanFromSubscription(String stripeSubscriptionId) {
        try {
            String priceId = stripeService.getSubscriptionPriceId(stripeSubscriptionId);
            if (priceId != null && priceId.equals(yearlyPriceId)) return SubscriptionPlan.YEARLY;
        } catch (StripeException e) {
            log.warn("Could not resolve plan for subscription {}: {}", stripeSubscriptionId, e.getMessage());
        }
        return SubscriptionPlan.MONTHLY;
    }

    private void handleInvoiceSucceeded(Invoice invoice) {
        subscriptionRepository.findByStripeSubscriptionId(invoice.getSubscription()).ifPresent(sub -> {
            if (invoice.getLines() != null && !invoice.getLines().getData().isEmpty()) {
                Long periodEnd = invoice.getLines().getData().get(0).getPeriod().getEnd();
                sub.setCurrentPeriodEnd(LocalDateTime.ofInstant(
                        Instant.ofEpochSecond(periodEnd), ZoneId.systemDefault()));
            }
            sub.setStatus(SubscriptionStatus.ACTIVE);
            subscriptionRepository.save(sub);
        });
    }

    private void handleInvoiceFailed(Invoice invoice) {
        subscriptionRepository.findByStripeSubscriptionId(invoice.getSubscription()).ifPresent(sub -> {
            sub.setStatus(SubscriptionStatus.PAST_DUE);
            subscriptionRepository.save(sub);
        });
    }

    private void handleSubscriptionDeleted(com.stripe.model.Subscription stripeSub) {
        subscriptionRepository.findByStripeSubscriptionId(stripeSub.getId()).ifPresent(sub -> {
            sub.setStatus(SubscriptionStatus.CANCELED);
            subscriptionRepository.save(sub);
        });
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
                .stripeSubscriptionId(sub.getStripeSubscriptionId())
                .build();
    }
}
