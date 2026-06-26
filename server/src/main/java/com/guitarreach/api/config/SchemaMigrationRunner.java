package com.guitarreach.api.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * One-off, idempotent schema fixes that Hibernate's {@code ddl-auto=update}
 * cannot perform on SQLite.
 *
 * The motivating case: {@code users.password_hash} was originally created
 * NOT NULL (when only password accounts existed) and later made nullable in
 * the entity for OAuth-only (Google/Facebook) accounts. Hibernate's "update"
 * mode never relaxes an existing NOT NULL constraint, and SQLite has no
 * {@code ALTER COLUMN}, so the live table keeps rejecting passwordless OAuth
 * inserts with "NOT NULL constraint failed: users.password_hash".
 *
 * This runner detects that stale constraint and rebuilds the table without it,
 * preserving all rows. It is safe to run on every startup: if the column is
 * already nullable it does nothing. Runs after the context is up so the table
 * (created/updated by Hibernate) already exists.
 */
@Component
@Order(0)
@RequiredArgsConstructor
@Slf4j
public class SchemaMigrationRunner implements ApplicationRunner {

    private final DataSource dataSource;

    @Override
    public void run(ApplicationArguments args) {
        try (Connection con = dataSource.getConnection()) {
            relaxUsersPasswordHashNotNull(con);
        } catch (Exception e) {
            // Don't crash the app over a migration probe; log loudly instead.
            log.error("Schema migration failed", e);
        }
    }

    /**
     * Rebuild the users table with a nullable password_hash if the live schema
     * still declares it NOT NULL.
     */
    private void relaxUsersPasswordHashNotNull(Connection con) throws Exception {
        String ddl = currentUsersDdl(con);
        if (ddl == null) {
            return; // table not created yet — nothing to do
        }
        // Normalize whitespace/case to spot "password_hash ... not null".
        String normalized = ddl.toLowerCase().replaceAll("\\s+", " ");
        boolean passwordHashNotNull = normalized.matches(".*password_hash\\s+varchar\\(\\d+\\)\\s+not null.*");
        if (!passwordHashNotNull) {
            return; // already nullable — idempotent no-op
        }

        log.warn("Migrating users.password_hash to nullable (was NOT NULL) for OAuth accounts");
        con.setAutoCommit(false);
        try (Statement st = con.createStatement()) {
            st.execute("PRAGMA foreign_keys=OFF");
            st.execute(
                "CREATE TABLE users_new (" +
                "  id integer," +
                "  created_at timestamp not null," +
                "  email varchar(255) not null unique," +
                "  email_verified boolean not null," +
                "  name varchar(255)," +
                "  password_hash varchar(255)," +
                "  role varchar(255) not null check (role in ('USER','ADMIN'))," +
                "  provider_id varchar(255)," +
                "  provider varchar(255) NOT NULL DEFAULT 'local'," +
                "  primary key (id)" +
                ")");
            st.execute(
                "INSERT INTO users_new (id, created_at, email, email_verified, name, password_hash, role, provider_id, provider) " +
                "SELECT id, created_at, email, email_verified, name, password_hash, role, provider_id, provider FROM users");
            st.execute("DROP TABLE users");
            st.execute("ALTER TABLE users_new RENAME TO users");
            con.commit();
            log.info("users.password_hash is now nullable; migration complete");
        } catch (Exception e) {
            con.rollback();
            throw e;
        } finally {
            con.setAutoCommit(true);
            try (Statement st = con.createStatement()) {
                st.execute("PRAGMA foreign_keys=ON");
            }
        }
    }

    private String currentUsersDdl(Connection con) throws Exception {
        try (Statement st = con.createStatement();
             ResultSet rs = st.executeQuery(
                 "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")) {
            return rs.next() ? rs.getString(1) : null;
        }
    }
}
