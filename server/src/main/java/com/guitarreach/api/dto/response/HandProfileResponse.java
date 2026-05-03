package com.guitarreach.api.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class HandProfileResponse {
    private Double thumbToIndex;
    private Double indexToMiddle;
    private Double middleToRing;
    private Double ringToLittle;
    private LocalDateTime updatedAt;
}
