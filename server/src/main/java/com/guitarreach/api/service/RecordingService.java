package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.RecordingRequest;
import com.guitarreach.api.dto.response.RecordingResponse;
import com.guitarreach.api.entity.Recording;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.repository.RecordingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Chord-recording scores (no audio). Append-only: every attempt is its own row,
 * scoped to the user resolved from the auth email — so per-chord level/trend can
 * be derived from the history later.
 */
@Service
@RequiredArgsConstructor
public class RecordingService {

    private final RecordingRepository recordingRepository;
    private final UserService userService;

    public List<RecordingResponse> list(String email) {
        User user = userService.getEntityByEmail(email);
        return recordingRepository.findByUserIdOrderByCreatedAtDesc(user.getId())
                .stream().map(this::toResponse).toList();
    }

    @Transactional
    public RecordingResponse add(String email, RecordingRequest req) {
        User user = userService.getEntityByEmail(email);
        Recording rec = Recording.builder()
                .user(user)
                .chord(req.getChord())
                .score(req.getScore())
                .level(req.getLevel())
                .quality(req.getQuality())
                .build();
        return toResponse(recordingRepository.save(rec));
    }

    private RecordingResponse toResponse(Recording r) {
        return RecordingResponse.builder()
                .id(r.getId())
                .chord(r.getChord())
                .score(r.getScore())
                .level(r.getLevel())
                .quality(r.getQuality())
                .createdAt(r.getCreatedAt())
                .build();
    }
}
