package com.guitarreach.api.controller;

import com.guitarreach.api.entity.CatalogSong;
import com.guitarreach.api.repository.CatalogSongRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Global song catalog (see {@link CatalogSong}). Populated by the
 * generate-music-data batch pipeline; read by anyone. Import is an upsert
 * keyed by (title, artist), so re-running the pipeline refreshes rows
 * instead of duplicating them.
 */
@RestController
@RequestMapping("/api/catalog")
@RequiredArgsConstructor
public class CatalogSongController {

    private final CatalogSongRepository repository;

    public record ImportRequest(String title, String artist, String songKey,
                                Integer bpm, String style, String chordpro, String sourceUrl) {}

    @GetMapping
    public List<CatalogSong> list() {
        return repository.findAll(Sort.by(Sort.Direction.ASC, "title"));
    }

    @PostMapping("/import")
    public ResponseEntity<CatalogSong> upsert(@RequestBody ImportRequest req) {
        if (req.title() == null || req.title().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        String artist = req.artist() == null ? "" : req.artist();
        CatalogSong row = repository
                .findByTitleIgnoreCaseAndArtistIgnoreCase(req.title(), artist)
                .orElseGet(CatalogSong::new);
        row.setTitle(req.title());
        row.setArtist(artist);
        row.setSongKey(req.songKey());
        row.setBpm(req.bpm());
        row.setStyle(req.style());
        row.setChordpro(req.chordpro());
        row.setSourceUrl(req.sourceUrl());
        return ResponseEntity.ok(repository.save(row));
    }
}
