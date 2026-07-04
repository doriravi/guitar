package com.guitarreach.api.repository;

import com.guitarreach.api.entity.CatalogSong;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface CatalogSongRepository extends JpaRepository<CatalogSong, Long> {
    Optional<CatalogSong> findByTitleIgnoreCaseAndArtistIgnoreCase(String title, String artist);
}
