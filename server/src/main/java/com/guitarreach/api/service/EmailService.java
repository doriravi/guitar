package com.guitarreach.api.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class EmailService {

    private final JavaMailSender mailSender;

    @Value("${app.frontend.url}")
    private String frontendUrl;

    @Value("${spring.mail.username:noreply@guitarreach.app}")
    private String fromAddress;

    // Sent off the request thread: a slow/unreachable SMTP host must never
    // block (or fail) registration or password-reset responses.
    @Async
    public void sendVerificationEmail(String toEmail, String token) {
        String link = frontendUrl + "/verify-email?token=" + token;
        send(toEmail, "Verify your Guitar Reach email",
                "Hi,\n\nPlease verify your email address by clicking the link below:\n\n"
                + link + "\n\nThis link expires in 24 hours.\n\nGuitar Reach");
    }

    @Async
    public void sendPasswordResetEmail(String toEmail, String token) {
        String link = frontendUrl + "/reset-password?token=" + token;
        send(toEmail, "Reset your Guitar Reach password",
                "Hi,\n\nClick the link below to reset your password:\n\n"
                + link + "\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.\n\nGuitar Reach");
    }

    private void send(String to, String subject, String body) {
        try {
            SimpleMailMessage msg = new SimpleMailMessage();
            msg.setFrom(fromAddress);
            msg.setTo(to);
            msg.setSubject(subject);
            msg.setText(body);
            mailSender.send(msg);
        } catch (Exception e) {
            log.error("Failed to send email to {}: {}", to, e.getMessage());
        }
    }
}
