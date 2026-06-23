package com.guitarreach.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guitarreach.api.dto.response.AuthResponse;
import com.guitarreach.api.entity.HandProfile;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.exception.ProviderNotConfiguredException;
import com.guitarreach.api.exception.UnauthorizedException;
import com.guitarreach.api.repository.HandProfileRepository;
import com.guitarreach.api.repository.UserRepository;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.util.Optional;

/**
 * Handles "Sign in with Google / Facebook".
 *
 * The frontend obtains a token from the provider's JS SDK and POSTs it here.
 * We verify that token directly against the provider's servers (so a forged
 * token can't mint a session), then find-or-create a local user and issue the
 * same JWT cookies as a normal login via {@link AuthService}.
 *
 * Credentials come from env vars; when a provider's id is blank the endpoint
 * returns 503 (ProviderNotConfiguredException), matching the app's
 * graceful-degradation convention.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OAuthService {

    private final UserRepository userRepository;
    private final HandProfileRepository handProfileRepository;
    private final AuthService authService;

    @Value("${oauth.google.client-id:}")
    private String googleClientId;

    @Value("${oauth.facebook.app-id:}")
    private String facebookAppId;

    @Value("${oauth.facebook.app-secret:}")
    private String facebookAppSecret;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String GOOGLE_TOKENINFO =
            "https://oauth2.googleapis.com/tokeninfo?id_token=";
    private static final String FACEBOOK_DEBUG_TOKEN =
            "https://graph.facebook.com/debug_token?input_token=%s&access_token=%s|%s";
    private static final String FACEBOOK_ME =
            "https://graph.facebook.com/me?fields=id,name,email&access_token=";

    public boolean googleEnabled() {
        return googleClientId != null && !googleClientId.isBlank();
    }

    public boolean facebookEnabled() {
        return facebookAppId != null && !facebookAppId.isBlank()
                && facebookAppSecret != null && !facebookAppSecret.isBlank();
    }

    /**
     * Verify a Google ID token (the credential from Google Identity Services),
     * then sign the user in.
     */
    public AuthResponse loginWithGoogle(String idToken, HttpServletResponse response) {
        if (!googleEnabled()) {
            throw new ProviderNotConfiguredException("Google sign-in is not configured on this server");
        }
        if (idToken == null || idToken.isBlank()) {
            throw new UnauthorizedException("Missing Google token");
        }

        JsonNode payload;
        try {
            String body = restTemplate.getForObject(GOOGLE_TOKENINFO + idToken, String.class);
            payload = objectMapper.readTree(body);
        } catch (Exception e) {
            log.warn("Google token verification failed: {}", e.getMessage());
            throw new UnauthorizedException("Could not verify Google token");
        }

        // The audience must be our own client id, else the token was minted for
        // some other app and must be rejected.
        String aud = payload.path("aud").asText("");
        if (!googleClientId.equals(aud)) {
            throw new UnauthorizedException("Google token was not issued for this application");
        }

        String providerId = payload.path("sub").asText("");
        String email = payload.path("email").asText("");
        String name = payload.path("name").asText("");
        if (providerId.isBlank()) {
            throw new UnauthorizedException("Google token missing subject id");
        }

        User user = findOrCreate("google", providerId, email, name);
        return authService.issueTokensForUser(user, response);
    }

    /**
     * Verify a Facebook access token (from the Facebook Login SDK), then sign
     * the user in.
     */
    public AuthResponse loginWithFacebook(String accessToken, HttpServletResponse response) {
        if (!facebookEnabled()) {
            throw new ProviderNotConfiguredException("Facebook sign-in is not configured on this server");
        }
        if (accessToken == null || accessToken.isBlank()) {
            throw new UnauthorizedException("Missing Facebook token");
        }

        // 1. Validate the token belongs to our app and is still valid.
        try {
            String debugUrl = String.format(FACEBOOK_DEBUG_TOKEN, accessToken, facebookAppId, facebookAppSecret);
            JsonNode debug = objectMapper.readTree(restTemplate.getForObject(debugUrl, String.class));
            JsonNode data = debug.path("data");
            boolean valid = data.path("is_valid").asBoolean(false);
            String appId = data.path("app_id").asText("");
            if (!valid || !facebookAppId.equals(appId)) {
                throw new UnauthorizedException("Facebook token is invalid for this application");
            }
        } catch (UnauthorizedException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Facebook token debug failed: {}", e.getMessage());
            throw new UnauthorizedException("Could not verify Facebook token");
        }

        // 2. Fetch the profile.
        JsonNode me;
        try {
            me = objectMapper.readTree(restTemplate.getForObject(FACEBOOK_ME + accessToken, String.class));
        } catch (Exception e) {
            log.warn("Facebook profile fetch failed: {}", e.getMessage());
            throw new UnauthorizedException("Could not load Facebook profile");
        }

        String providerId = me.path("id").asText("");
        String email = me.path("email").asText("");
        String name = me.path("name").asText("");
        if (providerId.isBlank()) {
            throw new UnauthorizedException("Facebook profile missing id");
        }

        User user = findOrCreate("facebook", providerId, email, name);
        return authService.issueTokensForUser(user, response);
    }

    /**
     * Find an existing account for this provider identity, or create one.
     * Matching order: (provider, providerId) first, then email — so a user who
     * originally signed up locally and later uses social login with the same
     * email is linked to the same account rather than duplicated.
     */
    @Transactional
    protected User findOrCreate(String provider, String providerId, String email, String name) {
        Optional<User> byProvider = userRepository.findByProviderAndProviderId(provider, providerId);
        if (byProvider.isPresent()) {
            return byProvider.get();
        }

        if (email != null && !email.isBlank()) {
            Optional<User> byEmail = userRepository.findByEmail(email);
            if (byEmail.isPresent()) {
                User existing = byEmail.get();
                // Link the social identity onto the existing account.
                if ("local".equals(existing.getProvider()) || existing.getProviderId() == null) {
                    existing.setProvider(provider);
                    existing.setProviderId(providerId);
                }
                // Social emails are provider-verified.
                existing.setEmailVerified(true);
                return userRepository.save(existing);
            }
        }

        User user = User.builder()
                .email(email != null && !email.isBlank() ? email : provider + "_" + providerId + "@oauth.local")
                .name(name)
                .provider(provider)
                .providerId(providerId)
                .emailVerified(true)
                .build();
        user = userRepository.save(user);

        // Default hand profile, matching local registration.
        HandProfile profile = HandProfile.builder().user(user).build();
        handProfileRepository.save(profile);

        return user;
    }
}
