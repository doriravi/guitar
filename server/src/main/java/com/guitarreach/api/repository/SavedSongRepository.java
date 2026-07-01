package com.guitarreach.api.repository;

import com.guitarreach.api.entity.SavedSong;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SavedSongRepository extends JpaRepository<SavedSong, Long> {
    List<SavedSong> findByUserIdOrderByUpdatedAtDesc(Long userId);

    Optional<SavedSong> findByUserIdAndClientId(Long userId, String clientId);

    Optional<SavedSong> findByIdAndUserId(Long id, Long userId);
}
