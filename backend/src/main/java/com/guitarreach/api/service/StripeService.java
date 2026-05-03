package com.guitarreach.api.service;

import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Event;
import com.stripe.model.checkout.Session;
import com.stripe.net.Webhook;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.checkout.SessionCreateParams;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
@Slf4j
public class StripeService {

    @Value("${stripe.webhook.secret}")
    private String webhookSecret;

    public String createOrGetCustomer(String email, String name) throws StripeException {
        CustomerCreateParams params = CustomerCreateParams.builder()
                .setEmail(email)
                .setName(name)
                .build();
        return Customer.create(params).getId();
    }

    public String createCheckoutSession(String customerId, String priceId,
                                        String successUrl, String cancelUrl) throws StripeException {
        SessionCreateParams params = SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.SUBSCRIPTION)
                .setCustomer(customerId)
                .addLineItem(SessionCreateParams.LineItem.builder()
                        .setPrice(priceId)
                        .setQuantity(1L)
                        .build())
                .setSuccessUrl(successUrl + "?session_id={CHECKOUT_SESSION_ID}")
                .setCancelUrl(cancelUrl)
                .build();
        return Session.create(params).getUrl();
    }

    public void cancelSubscription(String stripeSubscriptionId) throws StripeException {
        com.stripe.model.Subscription sub =
                com.stripe.model.Subscription.retrieve(stripeSubscriptionId);
        com.stripe.param.SubscriptionUpdateParams params =
                com.stripe.param.SubscriptionUpdateParams.builder()
                        .setCancelAtPeriodEnd(true)
                        .build();
        sub.update(params);
    }

    public Event constructWebhookEvent(String payload, String sigHeader) throws StripeException {
        return Webhook.constructEvent(payload, sigHeader, webhookSecret);
    }
}
