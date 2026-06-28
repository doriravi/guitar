package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.UpdateProfileRequest;
import com.guitarreach.api.dto.response.UserResponse;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.entity.VerificationToken;
import com.guitarreach.api.entity.VerificationToken.TokenType;
import com.guitarreach.api.exception.DuplicateEmailException;
import com.guitarreach.api.exception.ResourceNotFoundException;
import com.guitarreach.api.exception.UnauthorizedException;
import com.guitarreach.api.repository.PaymentRepository;
import com.guitarreach.api.repository.SubscriptionRepository;
import com.guitarreach.api.repository.UserRepository;
import com.guitarreach.api.repository.VerificationTokenRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {

    // Languages the frontend ships translations for. An unknown code is ignored
    // (falls back to the user's existing/default language) rather than rejected.
    private static final Set<String> SUPPORTED_LANGUAGES =
            Set.of("en", "es", "zh", "hi", "ar", "pt", "fr", "de", "ja", "ko");

    private final UserRepository userRepository;
    private final VerificationTokenRepository tokenRepository;
    private final PaymentRepository paymentRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailService emailService;

    public UserResponse getUser(String email) {
        return toResponse(getEntityByEmail(email));
    }

    public User getEntityByEmail(String email) {
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    @Transactional
    public UserResponse updateProfile(String email, UpdateProfileRequest req) {
        User user = getEntityByEmail(email);

        if (StringUtils.hasText(req.getName())) {
            user.setName(req.getName());
        }

        if (StringUtils.hasText(req.getLanguage())
                && SUPPORTED_LANGUAGES.contains(req.getLanguage())) {
            user.setLanguage(req.getLanguage());
        }

        if (StringUtils.hasText(req.getNewPassword())) {
            if (!StringUtils.hasText(req.getCurrentPassword()) ||
                !passwordEncoder.matches(req.getCurrentPassword(), user.getPasswordHash())) {
                throw new UnauthorizedException("Current password is incorrect");
            }
            user.setPasswordHash(passwordEncoder.encode(req.getNewPassword()));
        }

        if (StringUtils.hasText(req.getEmail()) && !req.getEmail().equalsIgnoreCase(email)) {
            if (userRepository.existsByEmail(req.getEmail())) {
                throw new DuplicateEmailException(req.getEmail());
            }
            user.setEmail(req.getEmail());
            user.setEmailVerified(false);
            sendVerificationToken(user);
        }

        return toResponse(userRepository.save(user));
    }

    /**
     * Permanently delete a user and ALL data related to them across every
     * table. handProfile and subscription are also cascaded by the User entity
     * (OneToOne, cascade=ALL), but payments are ManyToOne with a NOT NULL FK and
     * are NOT cascaded from User — so they must be removed explicitly or the
     * delete would hit a foreign-key constraint. We delete every child row up
     * front to be unambiguous and FK-safe.
     */
    @Transactional
    public void deleteAccount(String email) {
        User user = getEntityByEmail(email);
        Long userId = user.getId();

        // Children that reference the user, deleted first.
        paymentRepository.deleteByUserId(userId);
        tokenRepository.deleteByUserId(userId);
        subscriptionRepository.findByUserId(userId).ifPresent(subscriptionRepository::delete);

        // handProfile + subscription also cascade via the User entity; deleting
        // the user now removes the user row and any remaining cascaded rows.
        userRepository.delete(user);
    }

    // ── Email verification ────────────────────────────────────────────────────

    @Transactional
    public void sendVerificationToken(User user) {
        String token = UUID.randomUUID().toString();
        tokenRepository.save(VerificationToken.builder()
                .token(token)
                .user(user)
                .type(TokenType.EMAIL_VERIFY)
                .expiresAt(LocalDateTime.now().plusHours(24))
                .used(false)
                .build());
        emailService.sendVerificationEmail(user.getEmail(), token);
    }

    @Transactional
    public void verifyEmail(String token) {
        VerificationToken vt = tokenRepository.findByToken(token)
                .orElseThrow(() -> new UnauthorizedException("Invalid or expired token"));
        if (vt.isUsed() || vt.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw new UnauthorizedException("Invalid or expired token");
        }
        if (vt.getType() != TokenType.EMAIL_VERIFY) {
            throw new UnauthorizedException("Invalid token type");
        }
        User user = vt.getUser();
        user.setEmailVerified(true);
        userRepository.save(user);
        vt.setUsed(true);
        tokenRepository.save(vt);
    }

    // ── Password reset ────────────────────────────────────────────────────────

    @Transactional
    public void requestPasswordReset(String email) {
        userRepository.findByEmail(email).ifPresent(user -> {
            String token = UUID.randomUUID().toString();
            tokenRepository.save(VerificationToken.builder()
                    .token(token)
                    .user(user)
                    .type(TokenType.PASSWORD_RESET)
                    .expiresAt(LocalDateTime.now().plusHours(1))
                    .used(false)
                    .build());
            emailService.sendPasswordResetEmail(email, token);
        });
    }

    @Transactional
    public void confirmPasswordReset(String token, String newPassword) {
        VerificationToken vt = tokenRepository.findByToken(token)
                .orElseThrow(() -> new UnauthorizedException("Invalid or expired token"));
        if (vt.isUsed() || vt.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw new UnauthorizedException("Invalid or expired token");
        }
        if (vt.getType() != TokenType.PASSWORD_RESET) {
            throw new UnauthorizedException("Invalid token type");
        }
        User user = vt.getUser();
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        vt.setUsed(true);
        tokenRepository.save(vt);
    }

    private UserResponse toResponse(User user) {
        return UserResponse.builder()
                .id(user.getId())
                .email(user.getEmail())
                .name(user.getName())
                .role(user.getRole().name())
                .emailVerified(user.isEmailVerified())
                .language(user.getLanguage())
                .createdAt(user.getCreatedAt())
                .build();
    }
}
