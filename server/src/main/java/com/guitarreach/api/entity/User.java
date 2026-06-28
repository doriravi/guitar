package com.guitarreach.api.entity;

import com.guitarreach.api.enums.Role;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String email;

    // Nullable: OAuth-only accounts (Google/Facebook) have no local password.
    @Column(nullable = true)
    private String passwordHash;

    private String name;

    // OAuth provider info. provider is "local" for email/password accounts,
    // or "google" / "facebook" for social accounts. providerId is the stable
    // subject id returned by the provider.
    // columnDefinition gives a DB-level default so Hibernate's ddl-auto=update
    // can add this NOT NULL column to an already-populated table (SQLite refuses
    // a NOT NULL add without a default), and existing rows get backfilled.
    @Column(nullable = false, columnDefinition = "varchar(255) default 'local'")
    @Builder.Default
    private String provider = "local";

    private String providerId;

    // UI language preference (ISO code: en, es, zh, …). Defaults to English.
    // columnDefinition gives a DB-level default so Hibernate's ddl-auto=update can
    // add this NOT NULL column to an already-populated SQLite table (which refuses
    // a NOT NULL add without a default) and backfill existing rows.
    @Column(nullable = false, columnDefinition = "varchar(8) default 'en'")
    @Builder.Default
    private String language = "en";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private Role role = Role.USER;

    @Column(nullable = false)
    @Builder.Default
    private boolean emailVerified = false;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @OneToOne(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private HandProfile handProfile;

    @OneToOne(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private Subscription subscription;
}
