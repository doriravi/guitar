package com.guitarreach.api.controller;

import com.guitarreach.api.dto.request.SavedSongRequest;
import com.guitarreach.api.dto.response.SavedSongResponse;
import com.guitarreach.api.service.SavedSongService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/users/me/songs")
@RequiredArgsConstructor
public class SavedSongController {

    private final SavedSongService savedSongService;

    @GetMapping
    public ResponseEntity<List<SavedSongResponse>> list(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(savedSongService.list(userDetails.getUsername()));
    }

    @PutMapping
    public ResponseEntity<SavedSongResponse> save(@AuthenticationPrincipal UserDetails userDetails,
                                                  @Valid @RequestBody SavedSongRequest req) {
        return ResponseEntity.ok(savedSongService.save(userDetails.getUsername(), req));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal UserDetails userDetails,
                                       @PathVariable Long id) {
        savedSongService.delete(userDetails.getUsername(), id);
        return ResponseEntity.noContent().build();
    }
}
