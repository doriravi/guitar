package com.guitarreach.api.dto.request;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class HandProfileRequest {
    @NotNull @DecimalMin("1.0") @DecimalMax("30.0")
    private Double thumbToIndex;

    @NotNull @DecimalMin("1.0") @DecimalMax("20.0")
    private Double indexToMiddle;

    @NotNull @DecimalMin("1.0") @DecimalMax("20.0")
    private Double middleToRing;

    @NotNull @DecimalMin("1.0") @DecimalMax("20.0")
    private Double ringToLittle;
}
