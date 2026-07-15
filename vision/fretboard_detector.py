"""
fretboard_detector.py
=====================
Webcam hand/finger landmark tracker — a prototype for detecting where the
fingers land relative to a guitar fretboard.

This is a standalone Python experiment (separate from the app's in-browser
MediaPipe Hands tracker in client/src/components/CameraHandMeasure.jsx). It uses
OpenCV for camera capture + drawing and MediaPipe Hands for 21-point per-hand
landmark detection.

Stage 1 (this file): reliably capture the webcam, detect hand landmarks, and
draw them live, printing fingertip coordinates. Stage 2 (later): detect the
fretboard quadrilateral and map fingertips → (string, fret) cells.

Usage:
    python fretboard_detector.py                 # default camera 0
    python fretboard_detector.py --camera 1      # pick another camera
    python fretboard_detector.py --no-window     # headless self-test (CI / no display)
    python fretboard_detector.py --max-frames 60 # process N frames then exit

Controls (windowed mode):
    q or ESC   quit
    f          toggle fingertip coordinate overlay
    m          toggle the landmark mesh
"""

from __future__ import annotations

import argparse
import sys
import time

import cv2
import mediapipe as mp

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

# MediaPipe Hands landmark indices for the five fingertips.
FINGERTIPS = {
    "thumb": mp_hands.HandLandmark.THUMB_TIP,
    "index": mp_hands.HandLandmark.INDEX_FINGER_TIP,
    "middle": mp_hands.HandLandmark.MIDDLE_FINGER_TIP,
    "ring": mp_hands.HandLandmark.RING_FINGER_TIP,
    "pinky": mp_hands.HandLandmark.PINKY_TIP,
}
FINGER_COLORS = {
    "thumb": (0, 0, 255),     # red   (BGR)
    "index": (0, 165, 255),   # orange
    "middle": (0, 255, 255),  # yellow
    "ring": (0, 255, 0),      # green
    "pinky": (255, 0, 0),     # blue
}


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Webcam hand/finger landmark tracker.")
    p.add_argument("--camera", type=int, default=0,
                   help="camera index (default 0)")
    p.add_argument("--width", type=int, default=1280,
                   help="requested capture width")
    p.add_argument("--height", type=int, default=720,
                   help="requested capture height")
    p.add_argument("--max-hands", type=int, default=2,
                   help="max hands to track")
    p.add_argument("--max-frames", type=int, default=0,
                   help="stop after N processed frames (0 = run until quit)")
    p.add_argument("--no-window", action="store_true",
                   help="don't open a display window (headless self-test)")
    return p.parse_args(argv)


def open_camera(index: int, width: int, height: int):
    """Open the webcam, trying the DirectShow backend first on Windows
    (avoids the slow MSMF startup), then falling back to the default."""
    cap = None
    if sys.platform.startswith("win"):
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap.release()
            cap = None
    if cap is None:
        cap = cv2.VideoCapture(index)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap


def draw_overlay(frame, results, show_mesh: bool, show_coords: bool):
    """Draw the landmark mesh and fingertip markers onto `frame` in place.
    Returns a list of (hand_label, finger_name, x_px, y_px) fingertip records."""
    h, w = frame.shape[:2]
    tips = []
    if not results.multi_hand_landmarks:
        return tips

    handedness = results.multi_handedness or []
    for i, hand_landmarks in enumerate(results.multi_hand_landmarks):
        label = "?"
        if i < len(handedness):
            label = handedness[i].classification[0].label  # "Left" / "Right"

        if show_mesh:
            mp_drawing.draw_landmarks(
                frame,
                hand_landmarks,
                mp_hands.HAND_CONNECTIONS,
                mp_drawing_styles.get_default_hand_landmarks_style(),
                mp_drawing_styles.get_default_hand_connections_style(),
            )

        for name, idx in FINGERTIPS.items():
            lm = hand_landmarks.landmark[idx]
            x_px, y_px = int(lm.x * w), int(lm.y * h)
            tips.append((label, name, x_px, y_px))
            color = FINGER_COLORS[name]
            cv2.circle(frame, (x_px, y_px), 8, color, -1)
            cv2.circle(frame, (x_px, y_px), 8, (255, 255, 255), 1)
            if show_coords:
                cv2.putText(frame, f"{name[:1].upper()}", (x_px + 10, y_px - 6),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    return tips


def draw_hud(frame, fps: float, n_hands: int):
    h, w = frame.shape[:2]
    cv2.rectangle(frame, (0, 0), (w, 30), (0, 0, 0), -1)
    cv2.putText(frame,
                f"FPS {fps:5.1f} | hands {n_hands} | q=quit  m=mesh  f=coords",
                (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1,
                cv2.LINE_AA)


def main(argv=None) -> int:
    args = parse_args(argv)

    cap = open_camera(args.camera, args.width, args.height)
    if not cap or not cap.isOpened():
        print(f"ERROR: could not open camera index {args.camera}. "
              f"Is a webcam connected / not in use by another app?",
              file=sys.stderr)
        return 2

    print(f"Camera {args.camera} opened "
          f"({int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
          f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}). "
          f"{'Headless self-test.' if args.no_window else 'Press q or ESC to quit.'}")

    show_mesh = True
    show_coords = True
    frame_count = 0
    detected_frames = 0
    t_prev = time.perf_counter()
    fps = 0.0

    with mp_hands.Hands(
        model_complexity=1,
        max_num_hands=args.max_hands,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as hands:
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    print("WARNING: failed to read a frame; stopping.",
                          file=sys.stderr)
                    break

                # Mirror for a natural "selfie" view, then run detection on RGB.
                frame = cv2.flip(frame, 1)
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False
                results = hands.process(rgb)
                rgb.flags.writeable = True

                tips = draw_overlay(frame, results, show_mesh, show_coords)
                n_hands = len(results.multi_hand_landmarks or [])
                if n_hands:
                    detected_frames += 1

                # Smooth FPS estimate.
                t_now = time.perf_counter()
                dt = t_now - t_prev
                t_prev = t_now
                if dt > 0:
                    fps = 0.9 * fps + 0.1 * (1.0 / dt) if fps else 1.0 / dt

                frame_count += 1

                if args.no_window:
                    # Headless: print a compact status line every ~15 frames.
                    if frame_count % 15 == 0 or (tips and frame_count % 5 == 0):
                        summary = ", ".join(
                            f"{lab[0]}:{fn}=({x},{y})" for lab, fn, x, y in tips[:5]
                        ) or "no hands"
                        print(f"frame {frame_count:4d} fps {fps:5.1f} | {summary}")
                else:
                    draw_hud(frame, fps, n_hands)
                    cv2.imshow("Fretboard Detector — hand landmarks", frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), 27):  # q or ESC
                        break
                    if key == ord("m"):
                        show_mesh = not show_mesh
                    if key == ord("f"):
                        show_coords = not show_coords

                if args.max_frames and frame_count >= args.max_frames:
                    break
        finally:
            cap.release()
            cv2.destroyAllWindows()

    print(f"\nDone. Processed {frame_count} frames; "
          f"hands detected in {detected_frames}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
