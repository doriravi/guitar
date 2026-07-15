package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.CreateSubscriptionRequest;
import com.guitarreach.api.dto.response.SubscriptionResponse;
import com.guitarreach.api.entity.Payment;
import com.guitarreach.api.entity.Subscription;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.enums.PaymentStatus;
import com.guitarreach.api.enums.SubscriptionPlan;
import com.guitarreach.api.enums.SubscriptionStatus;
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
                .build();
    }
}
