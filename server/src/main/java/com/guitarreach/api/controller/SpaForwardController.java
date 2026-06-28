package com.guitarreach.api.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Serves the bundled single-page app (built React app copied into static/ at
 * Docker build time). Any non-API, non-file path is forwarded to index.html so
 * client-side routes and deep links resolve to the SPA instead of 404-ing.
 *
 * The pattern deliberately excludes:
 *   - /api/**            (REST endpoints)
 *   - paths with a dot   (real static files like .js/.css/.svg are served directly)
 *   - /actuator/**       (health checks)
 */
@Controller
public class SpaForwardController {

    @GetMapping(value = {
            "/",
            "/{path:^(?!api$|actuator$)[^\\.]*}",
            "/{path:^(?!api$|actuator$)[^\\.]*}/**"
    })
    public String forward() {
        return "forward:/index.html";
    }
}
