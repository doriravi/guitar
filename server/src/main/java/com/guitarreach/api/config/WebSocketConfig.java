package com.guitarreach.api.config;

import com.guitarreach.api.websocket.SongJamWebSocketHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers the live "jam" WebSocket endpoint used for multi-device shared
 * songwriting. Clients connect to {@code /ws/jam?room=CODE}; the handler relays
 * every message to the other members of the same room.
 *
 * Allowed origins mirror CorsConfig (localhost for dev, the Railway/Vercel hosts
 * for prod) so a phone on the deployed site can connect. The endpoint is raw
 * WebSocket (no STOMP/SockJS) so the browser can use the native WebSocket API
 * with no extra client library.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    @Bean
    public SongJamWebSocketHandler songJamWebSocketHandler() {
        return new SongJamWebSocketHandler();
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(songJamWebSocketHandler(), "/ws/jam")
                .setAllowedOriginPatterns(
                        "http://localhost:*",
                        "https://*.up.railway.app",
                        "https://*.vercel.app"
                );
    }
}
