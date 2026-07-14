package com.guitarreach.api.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * A graded attempt at playing a named chord — the SCORE only, no audio.
 *
 * When the user records themselves playing a chord (e.g. from the Start-here
 * cards), the frontend grades the mic capture with the existing reach/Play-Along
 * scorer and POSTs the result here. We keep the numeric outcome (0–100 score, a
 * 1–10 level, and the quality label) so a later feature can indicate the player's
 * level per chord over time. Deliberately append-only: each attempt is its own
 * historical row (no upsert), so progress/trend can be derived from the history.
 */
@Entity
@Table(name = "recordings",
        indexes = {
            @Index(name = "idx_recordings_user", columnList = "user_id"),
            @Index(name = "idx_recordings_user_chord", columnList = "user_id,chord")
        })
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Recording {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User user;

    // The chord name that was attempted (e.g. "C", "Am7").
    @Column(nullable = false)
    private String chord;

    // 0–100 cleanliness score from the frontend scorer.
    @Column(nullable = false)
    private int score;

    // 1–10 level derived from the score — the "level indication" this feeds.
    @Column(nullable = false)
    private int level;

    // Grade label: perfect | good | partial | miss | silent.
    private String quality;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
