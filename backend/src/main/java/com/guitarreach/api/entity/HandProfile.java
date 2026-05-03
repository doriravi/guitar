package com.guitarreach.api.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "hand_profiles")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HandProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User user;

    // All in cm — field names mirror DEFAULT_PROFILE keys in handProfile.js
    @Column(nullable = false)
    @Builder.Default
    private Double thumbToIndex = 13.5;

    @Column(nullable = false)
    @Builder.Default
    private Double indexToMiddle = 7.5;

    @Column(nullable = false)
    @Builder.Default
    private Double middleToRing = 6.0;

    @Column(nullable = false)
    @Builder.Default
    private Double ringToLittle = 9.5;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
