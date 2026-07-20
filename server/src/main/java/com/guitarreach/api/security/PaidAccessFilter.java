package com.guitarreach.api.security;

import com.guitarreach.api.service.SubscriptionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * The paywall. Using this backend costs $10/year; an authenticated user without
 * paid access gets 402 Payment Required on every API call except the handful
 * needed to sign in, see their status, and pay.
 *
 * Runs AFTER {@link JwtAuthenticationFilter} (so the principal is resolved) and
 * only ever inspects requests that are already authenticated — anonymous callers
 * fall through untouched and are handled by SecurityConfig's own rules, which
 * keeps "not logged in" a 401/403 and "logged in but unpaid" a 402. The frontend
 * distinguishes those two to show either the login modal or the paywall.
 *
 * Deliberately a servlet filter rather than per-controller annotations: a new
 * controller is protected the moment it is added, so shipping a paid feature can
 * never accidentally forget its gate. Anything genuinely free must be added to
 * {@link #FREE_PATHS} on purpose.
 */
@Component
@Slf4j
public class PaidAccessFilter extends OncePerRequestFilter {

    /**
     * Resolved lazily to break a bean cycle: SecurityConfig builds this filter,
     * but SubscriptionService → UserService needs the PasswordEncoder that
     * SecurityConfig itself defines. @Lazy injects a proxy here, so the real
     * service is only resolved on the first request — by which time the context
     * is fully built.
     */
    private final SubscriptionService subscriptionService;

    public PaidAccessFilter(@Lazy SubscriptionService subscriptionService) {
        this.subscriptionService = subscriptionService;
    }
    private final AntPathMatcher matcher = new AntPathMatcher();

    /**
     * Paths that stay usable without paying. Kept deliberately short: sign-in and
     * account recovery (you must be able to get into the account you paid for),
     * subscription status + PayPal (you must be able to pay), health/version
     * (infrastructure), and account deletion (you may always leave).
     */
    private static final List<String> FREE_PATHS = List.of(
            "/api/auth/**",
            "/api/users/verify-email",
            "/api/users/forgot-password",
            "/api/users/reset-password",
            "/api/users/me",          // reading your own account, incl. to sign out
            "/api/subscriptions/**",  // status + PayPal order create/capture
            "/api/version",
            "/actuator/**"
    );

    /**
     * Master switch. Defaults to ON in prod; a dev machine can set
     * `app.paywall.enabled=false` to work without a PayPal sandbox account.
     */
    @Value("${app.paywall.enabled:true}")
    private boolean paywallEnabled;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {

        if (!paywallEnabled || !requiresPayment(request)) {
            chain.doFilter(request, response);
            return;
        }

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        // Not authenticated → not our problem; SecurityConfig decides whether the
        // route is public (let it through) or protected (it will 401).
        if (auth == null || !auth.isAuthenticated() || auth.getPrincipal() == null
                || "anonymousUser".equals(String.valueOf(auth.getPrincipal()))) {
            chain.doFilter(request, response);
            return;
        }

        // Admins are never charged — they operate the service.
        boolean isAdmin = auth.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
        if (isAdmin) {
            chain.doFilter(request, response);
            return;
        }

        String email = auth.getName();
        if (subscriptionService.hasPaidAccess(email)) {
            chain.doFilter(request, response);
            return;
        }

        log.debug("402 for unpaid user {} on {}", email, request.getRequestURI());
        response.setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(
                "{\"status\":402,\"code\":\"PAYMENT_REQUIRED\","
                        + "\"message\":\"A paid subscription is required to use this feature.\"}");
    }

    /** Only API calls are gated — the SPA's own static assets stay public. */
    private boolean requiresPayment(HttpServletRequest request) {
        // CORS preflight carries no credentials and must never be rejected.
        if (HttpMethod.OPTIONS.matches(request.getMethod())) return false;

        String path = request.getRequestURI();
        if (path == null || !path.startsWith("/api/")) return false;

        return FREE_PATHS.stream().noneMatch(p -> matcher.match(p, path));
    }
}
