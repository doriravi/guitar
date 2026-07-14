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
public class RecordingResponse {
    private Long id;
    private String chord;
    private int score;
    private int level;
    private String quality;
    private LocalDateTime createdAt;
}
