package com.guitarreach.api.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * A graded chord attempt POSTed from the frontend — score only, no audio. The
 * frontend grades the mic capture with the existing scorer and sends the result.
 */
@Data
public class RecordingRequest {
    @NotBlank
    private String chord;

    @Min(0) @Max(100)
    private int score;

    @Min(1) @Max(10)
    private int level;

    // perfect | good | partial | miss | silent
    private String quality;
}
