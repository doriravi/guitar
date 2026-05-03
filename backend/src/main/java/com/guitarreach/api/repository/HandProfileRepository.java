package com.guitarreach.api.repository;

import com.guitarreach.api.entity.HandProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface HandProfileRepository extends JpaRepository<HandProfile, Long> {
    Optional<HandProfile> findByUserId(Long userId);
}
