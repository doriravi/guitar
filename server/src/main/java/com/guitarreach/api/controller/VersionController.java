package com.guitarreach.api.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Public build marker so we can confirm WHICH code is actually live on Railway.
 * Bump VERSION on each deploy; GET /api/version should return it as JSON. If this
 * returns the SPA's index.html instead, the API itself is being shadowed (routing
 * bug); if it returns an OLD version string, the deploy hasn't updated.
 */
@RestController
@RequestMapping("/api/version")
public class VersionController {

    private static final String VERSION = "routing-fix-2";

    @GetMapping
    public Map<String, String> version() {
        return Map.of("version", VERSION);
    }
}
