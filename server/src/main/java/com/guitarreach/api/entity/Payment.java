package com.guitarreach.api.entity;

import com.guitarreach.api.enums.PaymentStatus;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "payments")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Payment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User user;

    private Long amountCents;
    private String currency;

    @Enumerated(EnumType.STRING)
    private PaymentStatus status;

    private String stripePaymentIntentId;

    /** PayPal capture (transaction) id for payments taken through PayPal. */
    private String paypalCaptureId;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
