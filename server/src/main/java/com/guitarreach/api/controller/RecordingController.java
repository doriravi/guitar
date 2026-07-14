package com.guitarreach.api.controller;

import com.guitarreach.api.dto.request.RecordingRequest;
import com.guitarreach.api.dto.response.RecordingResponse;
import com.guitarreach.api.service.RecordingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Chord-recording SCORES for the current user. Auth is enforced by the
 * "/api/**" -> authenticated() rule in SecurityConfig; the user is resolved from
 * the JWT-cookie principal, so a client only needs to be logged in.
 */
@RestController
@RequestMapping("/api/users/me/recordings")
@RequiredArgsConstructor
public class RecordingController {

    private final RecordingService recordingService;

    @GetMapping
    public ResponseEntity<List<RecordingResponse>> list(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(recordingService.list(userDetails.getUsername()));
    }

    @PostMapping
    public ResponseEntity<RecordingResponse> add(@AuthenticationPrincipal UserDetails userDetails,
                                                 @Valid @RequestBody RecordingRequest req) {
        return ResponseEntity.ok(recordingService.add(userDetails.getUsername(), req));
    }
}
