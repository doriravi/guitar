package com.guitarreach.api.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * The global song catalog — one row per built-in song, populated by the
 * generate-music-data pipeline: real chord sheet fetched via /api/chordsheet,
 * converted to ChordPro (full lyrics inline), plus the musical metadata the
 * frontend's static songs.js carries (key, bpm) and a style/genre label.
 *
 * Unlike {@link SavedSong} (per-user, editor saves), this table is app-wide and
 * has no user relation. Upserts are keyed by (title, artist).
 */
@Entity
@Table(name = "catalog_songs",
        uniqueConstraints = @UniqueConstraint(columnNames = {"title", "artist"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CatalogSong {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String artist;

    // e.g. "C", "Em", "Bb" — the sheet's declared key, falling back to the
    // songs.js key. "key" alone is SQL-reserved in several dialects.
    @Column(name = "song_key")
    private String songKey;

    private Integer bpm;

    // Genre/style label, e.g. "Classic Rock", "Bossa Nova", "Jazz Standard".
    private String style;

    // Full lyriced ChordPro sheet (same format as the music-data/*.chordpro files).
    @Lob
    private String chordpro;

    // Where the sheet was fetched from (null when no sheet was found).
    private String sourceUrl;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
