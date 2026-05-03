package com.guitarreach.api.dto.request;

import com.guitarreach.api.enums.SubscriptionPlan;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class CreateSubscriptionRequest {
    @NotNull
    private SubscriptionPlan plan;
}
