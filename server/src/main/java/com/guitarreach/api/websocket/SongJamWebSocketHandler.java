package com.guitarreach.api.websocket;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Live "jam" relay for multi-device shared songwriting.
 *
 * Each connection joins a ROOM identified by a short code passed as the
 * {@code ?room=CODE} query parameter (e.g. wss://host/ws/jam?room=AB12). This
 * handler keeps an in-memory map of room → member sessions and simply
 * broadcasts every text frame it receives to the OTHER members of the same room
 * — so one phone editing the song is mirrored to every other phone in the room.
 *
 * Sessions are ephemeral: rooms live only while at least one member is
 * connected. Nothing is persisted (the app already has its own DB save path for
 * keeping a song). Presence frames of the form {@code {"type":"presence","count":N}}
 * are pushed to a room whenever membership changes so clients can show how many
 * devices are connected.
 */
public class SongJamWebSocketHandler extends TextWebSocketHandler {

    // room code → live sessions in that room. CopyOnWrite-ish via ConcurrentHashMap
    // newKeySet so join/leave during a broadcast are safe.
    private final Map<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();

    private static String roomOf(WebSocketSession session) {
        String query = session.getUri() != null ? session.getUri().getQuery() : null;
        if (query != null) {
            for (String part : query.split("&")) {
                int eq = part.indexOf('=');
                if (eq > 0 && "room".equals(part.substring(0, eq))) {
                    String code = part.substring(eq + 1).trim();
                    if (!code.isEmpty()) return code.toUpperCase();
                }
            }
        }
        return "LOBBY"; // fallback so a missing code still lands somewhere valid
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String room = roomOf(session);
        rooms.computeIfAbsent(room, r -> ConcurrentHashMap.newKeySet()).add(session);
        broadcastPresence(room);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String room = roomOf(session);
        Set<WebSocketSession> members = rooms.get(room);
        if (members == null) return;
        // Relay to everyone else in the room (not the sender).
        for (WebSocketSession peer : members) {
            if (peer != session && peer.isOpen()) {
                sendQuietly(peer, message.getPayload());
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String room = roomOf(session);
        Set<WebSocketSession> members = rooms.get(room);
        if (members != null) {
            members.remove(session);
            if (members.isEmpty()) rooms.remove(room);
            else broadcastPresence(room);
        }
    }

    private void broadcastPresence(String room) {
        Set<WebSocketSession> members = rooms.get(room);
        if (members == null) return;
        String frame = "{\"type\":\"presence\",\"count\":" + members.size() + "}";
        for (WebSocketSession peer : members) {
            if (peer.isOpen()) sendQuietly(peer, frame);
        }
    }

    private void sendQuietly(WebSocketSession peer, String payload) {
        try {
            peer.sendMessage(new TextMessage(payload));
        } catch (IOException ignored) {
            // A dead peer will be reaped on its own close event; ignore write races.
        }
    }
}
