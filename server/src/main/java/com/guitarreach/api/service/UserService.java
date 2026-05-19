package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.UpdateProfileRequest;
import com.guitarreach.api.dto.response.UserResponse;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.entity.VerificationToken;
import com.guitarreach.api.entity.VerificationToken.TokenType;
import com.guitarreach.api.exception.DuplicateEmailException;
import com.guitarreach.api.exception.ResourceNotFoundException;
import com.guitarreach.api.exception.UnauthorizedException;
import com.guitarreach.api.repository.UserRepository;
import com.guitarreach.api.repository.VerificationTokenRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final VerificationTokenRepository tokenRepository;
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

    @Transactional
    public void deleteAccount(String email) {
        User user = getEntityByEmail(email);
        tokenRepository.deleteByUserId(user.getId());
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
                .createdAt(user.getCreatedAt())
                .build();
    }
}
