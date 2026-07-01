package com.guitarreach.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SavedSongRequest {
    // The localStorage id the frontend assigned; stable across edits so a re-save
    // updates the same row instead of creating a duplicate.
    @NotBlank
    private String clientId;

    @NotBlank
    private String title;

    private String artist;

    // The full song object, JSON-serialized by the frontend.
    @NotBlank
    private String body;
}
