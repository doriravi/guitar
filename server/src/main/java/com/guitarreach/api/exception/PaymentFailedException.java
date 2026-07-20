package com.guitarreach.api.exception;

/**
 * A payment was attempted but did not result in access being granted — PayPal
 * declined it, it belonged to another account, or the amount was short.
 * Mapped to 402 Payment Required by GlobalExceptionHandler.
 */
public class PaymentFailedException extends RuntimeException {
    public PaymentFailedException(String message) {
        super(message);
    }
}
