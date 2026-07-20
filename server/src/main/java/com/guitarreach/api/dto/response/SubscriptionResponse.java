package com.guitarreach.api.dto.response;

import com.guitarreach.api.enums.SubscriptionPlan;
import com.guitarreach.api.enums.SubscriptionStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SubscriptionResponse {
    private SubscriptionPlan plan;
    private SubscriptionStatus status;
    private LocalDateTime currentPeriodEnd;

    /**
     * Whether this account currently has paid access — the same predicate the
     * server's paywall filter enforces. The SPA reads this rather than
     * re-deriving it from plan/status/date, so client and server can never
     * disagree about who is paid.
     */
    private boolean active;

    /** Price of the yearly pass, e.g. "10.00" — shown on the paywall screen. */
    private String priceUsd;

    /** False when the server has no PayPal credentials (the UI disables the button). */
    private boolean paypalConfigured;

    /**
     * Non-null only for legacy Stripe subscriptions created before the switch to
     * PayPal. The PayPal pass is a one-off yearly payment with nothing recurring
     * to cancel, so the UI only offers "cancel" when this is present.
     */
    private String stripeSubscriptionId;
}
