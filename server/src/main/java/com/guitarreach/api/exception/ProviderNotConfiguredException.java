package com.guitarreach.api.exception;

/**
 * Thrown when an OAuth provider (Google/Facebook) is selected but the server
 * has no credentials configured for it. Maps to HTTP 503, mirroring how the
 * hand-analysis endpoint degrades when its API key is absent.
 */
public class ProviderNotConfiguredException extends RuntimeException {
    public ProviderNotConfiguredException(String message) {
        super(message);
    }
}
