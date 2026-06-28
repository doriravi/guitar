package com.guitarreach.api.config;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Serves the bundled single-page app (built React app copied into static/ at
 * Docker build time) and provides the SPA fallback: a request for a path that is
 * NOT a real static file resolves to index.html, so client-side routes / deep
 * links work.
 *
 * This is implemented as a resource resolver (not a catch-all @Controller) so it
 * can NEVER intercept the REST API or actuator — those are handled by the normal
 * dispatcher BEFORE static resource handling, and this resolver only ever returns
 * index.html for paths that don't map to an endpoint or a real file.
 */
@Configuration
public class SpaWebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(@NonNull ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(@NonNull String resourcePath, @NonNull Resource location)
                            throws java.io.IOException {
                        // API and actuator are never static — let the dispatcher
                        // 404 them normally rather than returning the SPA shell.
                        if (resourcePath.startsWith("api/") || resourcePath.startsWith("actuator")) {
                            return null;
                        }
                        Resource requested = location.createRelative(resourcePath);
                        if (requested.exists() && requested.isReadable()) {
                            return requested; // a real file (JS/CSS/img/index.html)
                        }
                        // SPA route (no dot, no file) → serve the app shell.
                        return new ClassPathResource("/static/index.html");
                    }
                });
    }
}
