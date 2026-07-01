package com.guitarreach.api.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * A song the user has saved from the editor, with their transforms baked in.
 *
 * The whole song sheet (title, artist, key, lyric lines, chords) is stored as a
 * JSON blob in {@code body} — the same structured object the frontend's chord-sheet
 * parser / editor produces — so the server stays agnostic to the guitar-domain shape
 * (that logic lives entirely in the frontend). {@code clientId} is the localStorage
 * id the frontend assigns, used to dedupe on sync so an offline-saved song and its
 * server copy don't double up after login.
 */
@Entity
@Table(name = "saved_songs",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "client_id"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SavedSong {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User user;

    // The localStorage id the frontend assigned (e.g. "cs_169..._ab12"). Stable
    // across edits so a re-save updates the same row.
    @Column(name = "client_id", nullable = false)
    private String clientId;

    @Column(nullable = false)
    private String title;

    private String artist;

    // Full song object as JSON (lyricLines, chords, key, scaleType, bpm, …).
    @Lob
    @Column(nullable = false)
    private String body;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
