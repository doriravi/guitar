package com.guitarreach.api.repository;

import com.guitarreach.api.entity.Recording;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RecordingRepository extends JpaRepository<Recording, Long> {
    List<Recording> findByUserIdOrderByCreatedAtDesc(Long userId);

    void deleteByUserId(Long userId);
}
