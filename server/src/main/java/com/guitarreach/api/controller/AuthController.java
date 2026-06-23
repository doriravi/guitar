package com.guitarreach.api.controller;

import com.guitarreach.api.dto.request.LoginRequest;
import com.guitarreach.api.dto.request.OAuthLoginRequest;
import com.guitarreach.api.dto.request.RegisterRequest;
import com.guitarreach.api.dto.response.AuthResponse;
import com.guitarreach.api.service.AuthService;
import com.guitarreach.api.service.OAuthService;

import java.util.Map;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final OAuthService oauthService;

    /**
     * Tells the frontend which social sign-in buttons to enable. Lets the UI
     * render the design while disabling providers that have no server creds.
     */
    @GetMapping("/oauth/config")
    public ResponseEntity<Map<String, Boolean>> oauthConfig() {
        return ResponseEntity.ok(Map.of(
                "google", oauthService.googleEnabled(),
                "facebook", oauthService.facebookEnabled()
        ));
    }

    @PostMapping("/oauth/google")
    public ResponseEntity<AuthResponse> googleLogin(@Valid @RequestBody OAuthLoginRequest req,
                                                    HttpServletResponse response) {
        return ResponseEntity.ok(oauthService.loginWithGoogle(req.getToken(), response));
    }

    @PostMapping("/oauth/facebook")
    public ResponseEntity<AuthResponse> facebookLogin(@Valid @RequestBody OAuthLoginRequest req,
                                                      HttpServletResponse response) {
        return ResponseEntity.ok(oauthService.loginWithFacebook(req.getToken(), response));
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest req,
                                                 HttpServletResponse response) {
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(req, response));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest req,
                                              HttpServletResponse response) {
        return ResponseEntity.ok(authService.login(req, response));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(HttpServletRequest request,
                                                HttpServletResponse response) {
        String refreshToken = null;
        if (request.getCookies() != null) {
            refreshToken = Arrays.stream(request.getCookies())
                    .filter(c -> "jwt_refresh".equals(c.getName()))
                    .map(Cookie::getValue)
                    .findFirst()
                    .orElse(null);
        }
        if (refreshToken == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(authService.refreshToken(refreshToken, response));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletResponse response) {
        authService.logout(response);
        return ResponseEntity.noContent().build();
    }
}
