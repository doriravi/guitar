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
public class SavedSongResponse {
    private Long id;
    private String clientId;
    private String title;
    private String artist;
    private String body;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
