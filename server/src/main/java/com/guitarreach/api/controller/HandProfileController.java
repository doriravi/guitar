package com.guitarreach.api.controller;

import com.guitarreach.api.dto.request.HandProfileRequest;
import com.guitarreach.api.dto.response.HandProfileResponse;
import com.guitarreach.api.service.HandProfileService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users/me/hand-profile")
@RequiredArgsConstructor
public class HandProfileController {

    private final HandProfileService handProfileService;

    @GetMapping
    public ResponseEntity<HandProfileResponse> get(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(handProfileService.getProfile(userDetails.getUsername()));
    }

    @PutMapping
    public ResponseEntity<HandProfileResponse> save(@AuthenticationPrincipal UserDetails userDetails,
                                                    @Valid @RequestBody HandProfileRequest req) {
        return ResponseEntity.ok(handProfileService.saveProfile(userDetails.getUsername(), req));
    }
}
