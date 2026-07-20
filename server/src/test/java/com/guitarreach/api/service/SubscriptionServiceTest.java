package com.guitarreach.api.service;

import com.guitarreach.api.dto.response.SubscriptionResponse;
import com.guitarreach.api.entity.Subscription;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.enums.SubscriptionPlan;
import com.guitarreach.api.enums.SubscriptionStatus;
import com.guitarreach.api.exception.PaymentFailedException;
import com.guitarreach.api.repository.PaymentRepository;
import com.guitarreach.api.repository.SubscriptionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The money path: {@code capturePayPalOrder} is the one method that turns a
 * browser-supplied order id into a year of paid access, so every way it can be
 * tricked or mis-fire is pinned down here. A regression in this file means the
 * paywall either leaks free access or refuses a real payment.
 *
 * Hand-written stubs, not Mockito — same reason as {@code PaidAccessFilterTest}:
 * ByteBuddy cannot instrument classes on the JDK this repo builds with (Java 26),
 * so mocking frameworks fail to load. The collaborators here are small enough to
 * stub by hand, which also keeps each test's PayPal verdict explicit.
 */
class SubscriptionServiceTest {

    private static final String EMAIL = "player@example.com";
    private static final long USER_ID = 42L;

    private SubscriptionService service;
    private StubPayPal payPal;
    private StubSubscriptionRepo subs;
    private StubPaymentRepo payments;

    /** UserService stub: only getEntityByEmail is exercised; super() gets nulls. */
    private static final class StubUsers extends UserService {
        StubUsers() { super(null, null, null, null, null, null, null, null); }
        @Override public User getEntityByEmail(String email) {
            return User.builder().id(USER_ID).email(email).name("Player").build();
        }
    }

    /** PayPalService stub: returns a scripted capture result and price. */
    private static final class StubPayPal extends PayPalService {
        CaptureResult nextCapture;
        RuntimeException captureThrows;
        String priceUsd = "10.00";
        @Override public CaptureResult captureOrder(String orderId) {
            if (captureThrows != null) throw captureThrows;
            return nextCapture;
        }
        @Override public String getYearlyPriceUsd() { return priceUsd; }
        @Override public boolean isConfigured() { return true; }
    }

    /** Subscription repo stub: one in-memory row keyed by user id. */
    private static final class StubSubscriptionRepo implements SubscriptionRepository {
        Subscription stored;            // the row findByUserId returns (or null)
        Subscription lastSaved;         // what save() last persisted

        @Override public Optional<Subscription> findByUserId(Long userId) {
            return Optional.ofNullable(stored);
        }
        @Override public Optional<Subscription> findByStripeCustomerId(String c) { return Optional.empty(); }
        @Override public Optional<Subscription> findByStripeSubscriptionId(String s) { return Optional.empty(); }
        @Override public Optional<Subscription> findByPaypalOrderId(String o) { return Optional.empty(); }
        @Override public <S extends Subscription> S save(S entity) {
            lastSaved = entity; stored = entity; return entity;
        }
        // ── unused JpaRepository surface ─────────────────────────────────────
        @Override public void flush() {}
        @Override public <S extends Subscription> S saveAndFlush(S e) { return save(e); }
        @Override public <S extends Subscription> java.util.List<S> saveAllAndFlush(Iterable<S> e) { return null; }
        @Override public void deleteAllInBatch(Iterable<Subscription> e) {}
        @Override public void deleteAllByIdInBatch(Iterable<Long> ids) {}
        @Override public void deleteAllInBatch() {}
        @Override public Subscription getOne(Long id) { return null; }
        @Override public Subscription getById(Long id) { return null; }
        @Override public Subscription getReferenceById(Long id) { return null; }
        @Override public <S extends Subscription> java.util.List<S> findAll(org.springframework.data.domain.Example<S> ex) { return null; }
        @Override public <S extends Subscription> java.util.List<S> findAll(org.springframework.data.domain.Example<S> ex, org.springframework.data.domain.Sort s) { return null; }
        @Override public <S extends Subscription> java.util.List<S> saveAll(Iterable<S> e) { return null; }
        @Override public java.util.List<Subscription> findAll() { return null; }
        @Override public java.util.List<Subscription> findAllById(Iterable<Long> ids) { return null; }
        @Override public java.util.List<Subscription> findAll(org.springframework.data.domain.Sort s) { return null; }
        @Override public org.springframework.data.domain.Page<Subscription> findAll(org.springframework.data.domain.Pageable p) { return null; }
        @Override public Optional<Subscription> findById(Long id) { return Optional.empty(); }
        @Override public boolean existsById(Long id) { return false; }
        @Override public long count() { return 0; }
        @Override public void deleteById(Long id) {}
        @Override public void delete(Subscription e) {}
        @Override public void deleteAllById(Iterable<? extends Long> ids) {}
        @Override public void deleteAll(Iterable<? extends Subscription> e) {}
        @Override public void deleteAll() {}
        @Override public <S extends Subscription> Optional<S> findOne(org.springframework.data.domain.Example<S> ex) { return Optional.empty(); }
        @Override public <S extends Subscription> org.springframework.data.domain.Page<S> findAll(org.springframework.data.domain.Example<S> ex, org.springframework.data.domain.Pageable p) { return null; }
        @Override public <S extends Subscription> long count(org.springframework.data.domain.Example<S> ex) { return 0; }
        @Override public <S extends Subscription> boolean exists(org.springframework.data.domain.Example<S> ex) { return false; }
        @Override public <S extends Subscription, R> R findBy(org.springframework.data.domain.Example<S> ex, java.util.function.Function<org.springframework.data.repository.query.FluentQuery.FetchableFluentQuery<S>, R> q) { return null; }
    }

    /** Payment repo stub: records the last saved payment, ignores the rest. */
    private static final class StubPaymentRepo implements PaymentRepository {
        com.guitarreach.api.entity.Payment lastSaved;
        @Override public <S extends com.guitarreach.api.entity.Payment> S save(S entity) {
            lastSaved = entity; return entity;
        }
        @Override public java.util.List<com.guitarreach.api.entity.Payment> findByUserIdOrderByCreatedAtDesc(Long userId) { return java.util.List.of(); }
        @Override public Optional<com.guitarreach.api.entity.Payment> findByStripePaymentIntentId(String id) { return Optional.empty(); }
        @Override public void deleteByUserId(Long userId) {}
        @Override public void flush() {}
        @Override public <S extends com.guitarreach.api.entity.Payment> S saveAndFlush(S e) { return save(e); }
        @Override public <S extends com.guitarreach.api.entity.Payment> java.util.List<S> saveAllAndFlush(Iterable<S> e) { return null; }
        @Override public void deleteAllInBatch(Iterable<com.guitarreach.api.entity.Payment> e) {}
        @Override public void deleteAllByIdInBatch(Iterable<Long> ids) {}
        @Override public void deleteAllInBatch() {}
        @Override public com.guitarreach.api.entity.Payment getOne(Long id) { return null; }
        @Override public com.guitarreach.api.entity.Payment getById(Long id) { return null; }
        @Override public com.guitarreach.api.entity.Payment getReferenceById(Long id) { return null; }
        @Override public <S extends com.guitarreach.api.entity.Payment> java.util.List<S> findAll(org.springframework.data.domain.Example<S> ex) { return null; }
        @Override public <S extends com.guitarreach.api.entity.Payment> java.util.List<S> findAll(org.springframework.data.domain.Example<S> ex, org.springframework.data.domain.Sort s) { return null; }
        @Override public <S extends com.guitarreach.api.entity.Payment> java.util.List<S> saveAll(Iterable<S> e) { return null; }
        @Override public java.util.List<com.guitarreach.api.entity.Payment> findAll() { return null; }
        @Override public java.util.List<com.guitarreach.api.entity.Payment> findAllById(Iterable<Long> ids) { return null; }
        @Override public java.util.List<com.guitarreach.api.entity.Payment> findAll(org.springframework.data.domain.Sort s) { return null; }
        @Override public org.springframework.data.domain.Page<com.guitarreach.api.entity.Payment> findAll(org.springframework.data.domain.Pageable p) { return null; }
        @Override public Optional<com.guitarreach.api.entity.Payment> findById(Long id) { return Optional.empty(); }
        @Override public boolean existsById(Long id) { return false; }
        @Override public long count() { return 0; }
        @Override public void deleteById(Long id) {}
        @Override public void delete(com.guitarreach.api.entity.Payment e) {}
        @Override public void deleteAllById(Iterable<? extends Long> ids) {}
        @Override public void deleteAll(Iterable<? extends com.guitarreach.api.entity.Payment> e) {}
        @Override public void deleteAll() {}
        @Override public <S extends com.guitarreach.api.entity.Payment> Optional<S> findOne(org.springframework.data.domain.Example<S> ex) { return Optional.empty(); }
        @Override public <S extends com.guitarreach.api.entity.Payment> org.springframework.data.domain.Page<S> findAll(org.springframework.data.domain.Example<S> ex, org.springframework.data.domain.Pageable p) { return null; }
        @Override public <S extends com.guitarreach.api.entity.Payment> long count(org.springframework.data.domain.Example<S> ex) { return 0; }
        @Override public <S extends com.guitarreach.api.entity.Payment> boolean exists(org.springframework.data.domain.Example<S> ex) { return false; }
        @Override public <S extends com.guitarreach.api.entity.Payment, R> R findBy(org.springframework.data.domain.Example<S> ex, java.util.function.Function<org.springframework.data.repository.query.FluentQuery.FetchableFluentQuery<S>, R> q) { return null; }
    }

    @BeforeEach
    void setUp() {
        payPal = new StubPayPal();
        subs = new StubSubscriptionRepo();
        payments = new StubPaymentRepo();
        // SubscriptionService uses @RequiredArgsConstructor; build it via reflection-
        // free constructor injection by newing it and setting the private final fields.
        service = new SubscriptionService(subs, payments, new StubUsers(), payPal);
    }

    /** A COMPLETED capture for the right user and full price grants a year. */
    @Test
    void completedCaptureGrantsOneYear() {
        payPal.nextCapture = new PayPalService.CaptureResult(
                "COMPLETED", String.valueOf(USER_ID), "CAP-1", 1000L, "USD");

        SubscriptionResponse resp = service.capturePayPalOrder(EMAIL, "ORDER-1");

        assertThat(resp.getPlan()).isEqualTo(SubscriptionPlan.YEARLY);
        assertThat(resp.getStatus()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(resp.isActive()).isTrue();
        assertThat(subs.lastSaved.getCurrentPeriodEnd())
                .isAfter(LocalDateTime.now().plusMonths(11))
                .isBefore(LocalDateTime.now().plusMonths(13));
        assertThat(subs.lastSaved.getPaypalOrderId()).isEqualTo("ORDER-1");
        assertThat(payments.lastSaved).isNotNull();
        assertThat(payments.lastSaved.getPaypalCaptureId()).isEqualTo("CAP-1");
    }

    /** A capture PayPal did not complete is refused and grants nothing. */
    @Test
    void nonCompletedCaptureIsRejected() {
        payPal.nextCapture = new PayPalService.CaptureResult(
                "DECLINED", String.valueOf(USER_ID), null, 1000L, "USD");

        assertThatThrownBy(() -> service.capturePayPalOrder(EMAIL, "ORDER-2"))
                .isInstanceOf(PaymentFailedException.class)
                .hasMessageContaining("did not complete");
        assertThat(subs.lastSaved).isNull();      // nothing persisted
        assertThat(payments.lastSaved).isNull();
    }

    /** An order whose reference id is a DIFFERENT user is refused. */
    @Test
    void captureForDifferentUserIsRejected() {
        payPal.nextCapture = new PayPalService.CaptureResult(
                "COMPLETED", "999", "CAP-X", 1000L, "USD");

        assertThatThrownBy(() -> service.capturePayPalOrder(EMAIL, "ORDER-3"))
                .isInstanceOf(PaymentFailedException.class)
                .hasMessageContaining("different account");
        assertThat(subs.lastSaved).isNull();
    }

    /** An amount below the configured price is refused (underpayment guard). */
    @Test
    void underpaidCaptureIsRejected() {
        payPal.nextCapture = new PayPalService.CaptureResult(
                "COMPLETED", String.valueOf(USER_ID), "CAP-Y", 500L, "USD");

        assertThatThrownBy(() -> service.capturePayPalOrder(EMAIL, "ORDER-4"))
                .isInstanceOf(PaymentFailedException.class)
                .hasMessageContaining("did not match the price");
        assertThat(subs.lastSaved).isNull();
    }

    /** A null reference id (order with no echo) still passes the owner check. */
    @Test
    void nullReferenceIdIsAccepted() {
        payPal.nextCapture = new PayPalService.CaptureResult(
                "COMPLETED", null, "CAP-Z", 1000L, "USD");

        SubscriptionResponse resp = service.capturePayPalOrder(EMAIL, "ORDER-5");

        assertThat(resp.getStatus()).isEqualTo(SubscriptionStatus.ACTIVE);
    }

    /** Replaying an already-recorded order is a no-op, never a second year. */
    @Test
    void replayingSameOrderIsIdempotent() {
        LocalDateTime existingEnd = LocalDateTime.now().plusMonths(6);
        subs.stored = Subscription.builder()
                .plan(SubscriptionPlan.YEARLY)
                .status(SubscriptionStatus.ACTIVE)
                .currentPeriodEnd(existingEnd)
                .paypalOrderId("ORDER-6")
                .build();

        SubscriptionResponse resp = service.capturePayPalOrder(EMAIL, "ORDER-6");

        // capture was never called and the period end is unchanged.
        assertThat(subs.lastSaved).isNull();
        assertThat(resp.getCurrentPeriodEnd()).isEqualTo(existingEnd);
    }

    /** Paying again while still covered extends from the current end, not now. */
    @Test
    void payingWhileCoveredExtendsFromExistingEnd() {
        LocalDateTime existingEnd = LocalDateTime.now().plusMonths(6);
        subs.stored = Subscription.builder()
                .plan(SubscriptionPlan.YEARLY)
                .status(SubscriptionStatus.ACTIVE)
                .currentPeriodEnd(existingEnd)
                .paypalOrderId("OLD-ORDER")
                .build();
        payPal.nextCapture = new PayPalService.CaptureResult(
                "COMPLETED", String.valueOf(USER_ID), "CAP-N", 1000L, "USD");

        service.capturePayPalOrder(EMAIL, "NEW-ORDER");

        // new end ≈ existing end + 1 year, not now + 1 year.
        assertThat(subs.lastSaved.getCurrentPeriodEnd())
                .isAfter(existingEnd.plusMonths(11))
                .isBefore(existingEnd.plusMonths(13));
    }

    /** hasPaidAccess is true only for an ACTIVE, unexpired subscription. */
    @Test
    void hasPaidAccessReflectsActiveUnexpired() {
        subs.stored = Subscription.builder()
                .status(SubscriptionStatus.ACTIVE)
                .currentPeriodEnd(LocalDateTime.now().plusDays(1))
                .build();
        assertThat(service.hasPaidAccess(EMAIL)).isTrue();
    }

    /** An expired period denies access even while status is still ACTIVE. */
    @Test
    void hasPaidAccessDeniesExpiredPeriod() {
        subs.stored = Subscription.builder()
                .status(SubscriptionStatus.ACTIVE)
                .currentPeriodEnd(LocalDateTime.now().minusDays(1))
                .build();
        assertThat(service.hasPaidAccess(EMAIL)).isFalse();
    }

    /** A null period end never grants access, even if ACTIVE. */
    @Test
    void hasPaidAccessDeniesNullPeriodEnd() {
        subs.stored = Subscription.builder()
                .status(SubscriptionStatus.ACTIVE)
                .currentPeriodEnd(null)
                .build();
        assertThat(service.hasPaidAccess(EMAIL)).isFalse();
    }

    /** No subscription row at all is unpaid, not an error. */
    @Test
    void hasPaidAccessDeniesWhenNoSubscription() {
        subs.stored = null;
        assertThat(service.hasPaidAccess(EMAIL)).isFalse();
    }
}
