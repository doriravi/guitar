package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.LoginRequest;
import com.guitarreach.api.dto.request.RegisterRequest;
import com.guitarreach.api.dto.response.AuthResponse;
import com.guitarreach.api.entity.HandProfile;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.exception.DuplicateEmailException;
import com.guitarreach.api.repository.HandProfileRepository;
import com.guitarreach.api.repository.UserRepository;
import com.guitarreach.api.security.JwtTokenProvider;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {

    // Languages the frontend ships translations for; mirrors UserService.
    private static final java.util.Set<String> SUPPORTED_LANGUAGES =
            java.util.Set.of("en", "es", "zh", "hi", "ar", "pt", "fr", "de", "ja", "ko");

    private final UserRepository userRepository;
    private final HandProfileRepository handProfileRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider tokenProvider;
    private final AuthenticationManager authManager;
    private final UserDetailsService userDetailsService;
    private final UserService userService;

    @Value("${app.jwt.refresh-token-expiry-ms}")
    private long refreshTokenExpiryMs;

    @Value("${app.cookie.secure:false}")
    private boolean cookieSecure;

    @Transactional
    public AuthResponse register(RegisterRequest req, HttpServletResponse response) {
        if (userRepository.existsByEmail(req.getEmail())) {
            throw new DuplicateEmailException(req.getEmail());
        }

        User.UserBuilder builder = User.builder()
                .email(req.getEmail())
                .passwordHash(passwordEncoder.encode(req.getPassword()))
                .name(req.getName());
        if (SUPPORTED_LANGUAGES.contains(req.getLanguage())) {
            builder.language(req.getLanguage());
        }
        User user = userRepository.save(builder.build());

        // Create default hand profile so the frontend can immediately sync
        HandProfile profile = HandProfile.builder().user(user).build();
        handProfileRepository.save(profile);

        // Send email verification (best-effort, don't fail registration if mail is down)
        try { userService.sendVerificationToken(user); } catch (Exception ignored) {}

        return issueTokensAndBuildResponse(user, response);
    }

    public AuthResponse login(LoginRequest req, HttpServletResponse response) {
        authManager.authenticate(
                new UsernamePasswordAuthenticationToken(req.getEmail(), req.getPassword()));

        User user = userRepository.findByEmail(req.getEmail()).orElseThrow();
        return issueTokensAndBuildResponse(user, response);
    }

    public AuthResponse refreshToken(String refreshToken, HttpServletResponse response) {
        if (!tokenProvider.validateToken(refreshToken)) {
            throw new com.guitarreach.api.exception.UnauthorizedException("Invalid refresh token");
        }
        String email = tokenProvider.getEmailFromToken(refreshToken);
        User user = userRepository.findByEmail(email).orElseThrow();
        UserDetails userDetails = userDetailsService.loadUserByUsername(email);
        String newAccessToken = tokenProvider.generateAccessToken(userDetails);
        setAccessTokenCookie(response, newAccessToken);
        return buildResponse(user);
    }

    public void logout(HttpServletResponse response) {
        clearCookie(response, "jwt_access");
        clearCookie(response, "jwt_refresh");
    }

    /**
     * Issue JWT cookies for an already-resolved user (e.g. after OAuth sign-in)
     * and build the standard auth response. Reuses the same cookie plumbing as
     * local login/registration.
     */
    public AuthResponse issueTokensForUser(User user, HttpServletResponse response) {
        return issueTokensAndBuildResponse(user, response);
    }

    private AuthResponse issueTokensAndBuildResponse(User user, HttpServletResponse response) {
        UserDetails userDetails = userDetailsService.loadUserByUsername(user.getEmail());
        String accessToken = tokenProvider.generateAccessToken(userDetails);
        String refreshToken = tokenProvider.generateRefreshToken(user.getEmail());

        setAccessTokenCookie(response, accessToken);
        setRefreshTokenCookie(response, refreshToken);

        return buildResponse(user);
    }

    private AuthResponse buildResponse(User user) {
        return AuthResponse.builder()
                .userId(user.getId())
                .email(user.getEmail())
                .name(user.getName())
                .role(user.getRole().name())
                .language(user.getLanguage())
                .build();
    }

    // SameSite policy for the auth cookies. When the frontend and backend are on
    // DIFFERENT sites (e.g. frontend on guitar-production.up.railway.app, backend
    // on perfect-compassion.up.railway.app), the browser only sends cookies on
    // cross-site requests when SameSite=None — and SameSite=None REQUIRES Secure.
    // Set COOKIE_SAME_SITE=None (and COOKIE_SECURE=true) in that cross-site prod.
    // Defaults to Lax for same-site / local dev.
    @Value("${app.cookie.same-site:Lax}")
    private String cookieSameSite;

    private void setAccessTokenCookie(HttpServletResponse response, String token) {
        addCookie(response, "jwt_access", token, "/", 900); // 15 minutes
    }

    private void setRefreshTokenCookie(HttpServletResponse response, String token) {
        addCookie(response, "jwt_refresh", token, "/api/auth/refresh",
                (int) (refreshTokenExpiryMs / 1000));
    }

    private void clearCookie(HttpServletResponse response, String name) {
        addCookie(response, name, "", "/", 0);
    }

    /**
     * Write an auth cookie with SameSite support via ResponseCookie (the legacy
     * jakarta Cookie API can't set SameSite). SameSite=None is force-paired with
     * Secure, which browsers require, regardless of the cookieSecure flag.
     */
    private void addCookie(HttpServletResponse response, String name, String value,
                           String path, int maxAgeSeconds) {
        boolean none = "None".equalsIgnoreCase(cookieSameSite);
        org.springframework.http.ResponseCookie cookie =
                org.springframework.http.ResponseCookie.from(name, value)
                        .httpOnly(true)
                        .secure(cookieSecure || none)   // None mandates Secure
                        .path(path)
                        .maxAge(maxAgeSeconds)
                        .sameSite(none ? "None" : cookieSameSite)
                        .build();
        response.addHeader(org.springframework.http.HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
