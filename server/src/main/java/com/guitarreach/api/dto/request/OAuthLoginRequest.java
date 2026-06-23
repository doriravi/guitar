package com.guitarreach.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Token returned by a provider's JS SDK (Google ID token, or Facebook access
 * token), forwarded to the backend for verification.
 */
@Data
public class OAuthLoginRequest {
    @NotBlank
    private String token;
}
