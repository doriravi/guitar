package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.SavedSongRequest;
import com.guitarreach.api.dto.response.SavedSongResponse;
import com.guitarreach.api.entity.SavedSong;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.exception.ResourceNotFoundException;
import com.guitarreach.api.repository.SavedSongRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class SavedSongService {

    private final SavedSongRepository savedSongRepository;
    private final UserService userService;

    public List<SavedSongResponse> list(String email) {
        User user = userService.getEntityByEmail(email);
        return savedSongRepository.findByUserIdOrderByUpdatedAtDesc(user.getId())
                .stream().map(this::toResponse).toList();
    }

    /**
     * Upsert by clientId: a re-save of the same song (same localStorage id) updates
     * the existing row; a new clientId inserts. Keyed per user so two users can keep
     * songs with the same clientId/title independently.
     */
    @Transactional
    public SavedSongResponse save(String email, SavedSongRequest req) {
        User user = userService.getEntityByEmail(email);
        SavedSong song = savedSongRepository.findByUserIdAndClientId(user.getId(), req.getClientId())
                .orElse(SavedSong.builder().user(user).clientId(req.getClientId()).build());

        song.setTitle(req.getTitle());
        song.setArtist(req.getArtist());
        song.setBody(req.getBody());

        return toResponse(savedSongRepository.save(song));
    }

    @Transactional
    public void delete(String email, Long id) {
        User user = userService.getEntityByEmail(email);
        SavedSong song = savedSongRepository.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Saved song not found"));
        savedSongRepository.delete(song);
    }

    private SavedSongResponse toResponse(SavedSong s) {
        return SavedSongResponse.builder()
                .id(s.getId())
                .clientId(s.getClientId())
                .title(s.getTitle())
                .artist(s.getArtist())
                .body(s.getBody())
                .createdAt(s.getCreatedAt())
                .updatedAt(s.getUpdatedAt())
                .build();
    }
}
