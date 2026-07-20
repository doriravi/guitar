package com.guitarreach.api.security;

import com.guitarreach.api.service.SubscriptionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The paywall is the thing standing between an unpaid account and a backend that
 * costs money to run, so its rules are pinned down here rather than checked by
 * hand: who gets through, who gets 402, and which paths stay free.
 *
 * Uses hand-written stubs instead of Mockito on purpose — the two collaborators
 * are trivial, and Mockito's ByteBuddy cannot instrument classes on the JDK this
 * repo builds with (Java 26).
 */
class PaidAccessFilterTest {

    /** Records whether the request was allowed to continue down the chain. */
    private static final class RecordingChain implements FilterChain {
        int calls = 0;
        @Override public void doFilter(ServletRequest req, ServletResponse res) { calls++; }
    }

    /** SubscriptionService stub: answers a fixed paid/unpaid verdict and counts lookups. */
    private static final class StubSubscriptions extends SubscriptionService {
        boolean paid;
        int lookups = 0;
        StubSubscriptions() { super(null, null, null, null); }
        @Override public boolean hasPaidAccess(String email) { lookups++; return paid; }
    }

    private StubSubscriptions subscriptions;
    private PaidAccessFilter filter;
    private RecordingChain chain;

    @BeforeEach
    void setUp() {
        subscriptions = new StubSubscriptions();
        filter = new PaidAccessFilter(subscriptions);
        ReflectionTestUtils.setField(filter, "paywallEnabled", true);
        chain = new RecordingChain();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(String email, String... roles) {
        List<SimpleGrantedAuthority> authorities = java.util.Arrays.stream(roles)
                .map(SimpleGrantedAuthority::new).toList();
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(email, null, authorities));
    }

    private MockHttpServletResponse run(String method, String uri) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest(method, uri);
        req.setRequestURI(uri);
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilterInternal(req, res, chain);
        return res;
    }

    @Test
    void unpaidUserIsBlockedWith402() throws Exception {
        authenticateAs("broke@example.com", "ROLE_USER");
        subscriptions.paid = false;

        MockHttpServletResponse res = run("GET", "/api/recordings");

        assertThat(res.getStatus()).isEqualTo(402);
        assertThat(res.getContentAsString()).contains("PAYMENT_REQUIRED");
        assertThat(chain.calls).isZero();
    }

    @Test
    void paidUserPassesThrough() throws Exception {
        authenticateAs("paid@example.com", "ROLE_USER");
        subscriptions.paid = true;

        MockHttpServletResponse res = run("GET", "/api/recordings");

        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(chain.calls).isEqualTo(1);
    }

    @Test
    void adminsAreNeverCharged() throws Exception {
        authenticateAs("admin@example.com", "ROLE_ADMIN");

        run("GET", "/api/recordings");

        assertThat(chain.calls).isEqualTo(1);
        // The subscription store shouldn't even be consulted for an admin.
        assertThat(subscriptions.lookups).isZero();
    }

    /**
     * An anonymous caller must fall through untouched so Spring Security can
     * decide the route — otherwise "not logged in" would surface as 402 instead
     * of 401 and the SPA would show a paywall instead of the login form.
     */
    @Test
    void anonymousRequestsAreLeftToSpringSecurity() throws Exception {
        MockHttpServletResponse res = run("GET", "/api/recordings");

        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(chain.calls).isEqualTo(1);
        assertThat(subscriptions.lookups).isZero();
    }

    @Test
    void authAndBillingPathsStayFreeForUnpaidUsers() throws Exception {
        authenticateAs("broke@example.com", "ROLE_USER");
        subscriptions.paid = false;

        // You must always be able to sign in, see what you owe, and pay it.
        List<String> free = List.of(
                "/api/auth/login",
                "/api/auth/refresh",
                "/api/users/me",
                "/api/users/reset-password",
                "/api/subscriptions/me",
                "/api/subscriptions/paypal/order",
                "/api/subscriptions/paypal/capture",
                "/api/version",
                "/actuator/health");
        for (String path : free) {
            MockHttpServletResponse res = run("GET", path);
            assertThat(res.getStatus()).as("%s must stay free", path).isEqualTo(200);
        }
        assertThat(chain.calls).isEqualTo(free.size());
    }

    /**
     * The free path "/api/users/me" is an EXACT match, not a prefix. The real
     * paid features live underneath it (/api/users/me/recordings,
     * /api/users/me/hand-profile), so a prefix match here would silently hand
     * the whole backend away for free.
     */
    @Test
    void nestedUserPathsAreStillPaywalled() throws Exception {
        authenticateAs("broke@example.com", "ROLE_USER");
        subscriptions.paid = false;

        assertThat(run("GET", "/api/users/me").getStatus())
                .as("the account itself stays readable").isEqualTo(200);
        assertThat(run("GET", "/api/users/me/recordings").getStatus()).isEqualTo(402);
        assertThat(run("GET", "/api/users/me/hand-profile").getStatus()).isEqualTo(402);
        assertThat(run("POST", "/api/users/me/recordings").getStatus()).isEqualTo(402);
    }

    @Test
    void nonApiPathsAreNeverGated() throws Exception {
        authenticateAs("broke@example.com", "ROLE_USER");
        subscriptions.paid = false;

        // The SPA's own assets are public — the paywall only guards the API.
        assertThat(run("GET", "/index.html").getStatus()).isEqualTo(200);
        assertThat(run("GET", "/assets/app.js").getStatus()).isEqualTo(200);
        assertThat(chain.calls).isEqualTo(2);
    }

    @Test
    void corsPreflightIsNeverBlocked() throws Exception {
        authenticateAs("broke@example.com", "ROLE_USER");
        subscriptions.paid = false;

        assertThat(run("OPTIONS", "/api/recordings").getStatus()).isEqualTo(200);
        assertThat(chain.calls).isEqualTo(1);
    }

    @Test
    void disablingThePaywallLetsEveryoneThrough() throws Exception {
        ReflectionTestUtils.setField(filter, "paywallEnabled", false);
        authenticateAs("broke@example.com", "ROLE_USER");
        subscriptions.paid = false;

        assertThat(run("GET", "/api/recordings").getStatus()).isEqualTo(200);
        assertThat(chain.calls).isEqualTo(1);
    }
}
