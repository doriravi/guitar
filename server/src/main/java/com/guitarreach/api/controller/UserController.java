package com.guitarreach.api.controller;

import com.guitarreach.api.dto.request.PasswordResetConfirmRequest;
import com.guitarreach.api.dto.request.PasswordResetRequest;
import com.guitarreach.api.dto.request.UpdateProfileRequest;
import com.guitarreach.api.dto.response.UserResponse;
import com.guitarreach.api.service.UserService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @GetMapping("/me")
    public ResponseEntity<UserResponse> getMe(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(userService.getUser(userDetails.getUsername()));
    }

    @PutMapping("/me")
    public ResponseEntity<UserResponse> updateMe(@AuthenticationPrincipal UserDetails userDetails,
                                                  @Valid @RequestBody UpdateProfileRequest req) {
        return ResponseEntity.ok(userService.updateProfile(userDetails.getUsername(), req));
    }

    @DeleteMapping("/me")
    public ResponseEntity<Void> deleteMe(@AuthenticationPrincipal UserDetails userDetails,
                                          HttpServletResponse response) {
        userService.deleteAccount(userDetails.getUsername());
        clearCookie(response, "jwt_access");
        clearCookie(response, "jwt_refresh");
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/me/resend-verification")
    public ResponseEntity<Void> resendVerification(@AuthenticationPrincipal UserDetails userDetails) {
        userService.sendVerificationToken(userService.getEntityByEmail(userDetails.getUsername()));
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/verify-email")
    public ResponseEntity<Void> verifyEmail(@RequestParam String token) {
        userService.verifyEmail(token);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<Void> forgotPassword(@Valid @RequestBody PasswordResetRequest req) {
        userService.requestPasswordReset(req.getEmail());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/reset-password")
    public ResponseEntity<Void> resetPassword(@Valid @RequestBody PasswordResetConfirmRequest req) {
        userService.confirmPasswordReset(req.getToken(), req.getNewPassword());
        return ResponseEntity.noContent().build();
    }

    // Must mirror the SameSite/Secure attributes used when the cookie was SET
    // (AuthService), or the browser won't recognize and expire it cross-site.
    @Value("${app.cookie.secure:false}")
    private boolean cookieSecure;

    @Value("${app.cookie.same-site:Lax}")
    private String cookieSameSite;

    private void clearCookie(HttpServletResponse response, String name) {
        boolean none = "None".equalsIgnoreCase(cookieSameSite);
        ResponseCookie cookie = ResponseCookie.from(name, "")
                .httpOnly(true)
                .secure(cookieSecure || none)
                .path("/")
                .maxAge(0)
                .sameSite(none ? "None" : cookieSameSite)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
