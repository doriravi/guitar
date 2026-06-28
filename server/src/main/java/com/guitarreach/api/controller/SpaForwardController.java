package com.guitarreach.api.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.server.ResponseStatusException;

/**
 * SPA fallback for the bundled React app.
 *
 * Spring Boot already serves real static files from classpath:/static/ (index.html,
 * /assets/**, images) via its default resource handler. We deliberately do NOT add
 * a custom /** RESOURCE handler — a greedy resource handler is registered at a
 * priority that shadows the REST controllers, which made the whole API return
 * index.html.
 *
 * This is a /** CONTROLLER mapping instead. Spring MVC resolves the MOST SPECIFIC
 * pattern first, so concrete mappings (/api/auth/**, /actuator/**, every other
 * @RestController route) always win over this catch-all. It only runs for a GET
 * that matched no other handler and no real static file — a client-side route —
 * which we forward to index.html so deep links work.
 */
@Controller
public class SpaForwardController {

    @GetMapping("/**")
    public String spaFallback(HttpServletRequest request) {
        String path = request.getRequestURI();

        // Defensive: never serve the SPA shell for API/actuator paths. They should
        // already have matched their own controllers; if one slips through it must
        // 404 as a normal error, not as HTML (which would silently break the API).
        if (path.startsWith("/api/") || path.equals("/api") || path.startsWith("/actuator")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        // A path whose last segment has a file extension but reached here means the
        // static file does not exist → 404 it rather than masking a missing asset
        // (e.g. a renamed .js/.css) with the HTML shell.
        int lastSlash = path.lastIndexOf('/');
        String lastSegment = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
        if (lastSegment.contains(".")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        // Genuine client-side route → serve the SPA shell.
        return "forward:/index.html";
    }
}
