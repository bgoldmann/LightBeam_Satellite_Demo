# Satellite Safe broadcast profile notes

Locked defaults for first on-air demo:

- 1920×1080p
- 30 fps encode (25 fps variant when station requires)
- Symbol hold: 3 video frames
- Redundancy ~85%
- Block size 192 bytes
- QR ECC Medium
- One QR per frame, large modules, quiet zone
- Overlay: title, publisher, EN+FA instructions, session short code, progress bar
- Logo/ticker safe regions reserved

Tuning after ladder tests: increase hold or redundancy if downlink loss >50%.
