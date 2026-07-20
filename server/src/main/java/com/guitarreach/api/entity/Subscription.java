package com.guitarreach.api.entity;

import com.guitarreach.api.enums.SubscriptionPlan;
import com.guitarreach.api.enums.SubscriptionStatus;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "subscriptions")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Subscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User user;

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private SubscriptionPlan plan = SubscriptionPlan.FREE;

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private SubscriptionStatus status = SubscriptionStatus.INACTIVE;

    private String stripeCustomerId;
    private String stripeSubscriptionId;

    /** PayPal order id of the most recent successful $10/year purchase. */
    private String paypalOrderId;

    /**
     * When paid access ends. This is the single source of truth for the paywall
     * ({@code PaidAccessFilter}): access is granted iff status is ACTIVE and this
     * is in the future. A PayPal purchase pushes it out by one year.
     */
    private LocalDateTime currentPeriodEnd;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
