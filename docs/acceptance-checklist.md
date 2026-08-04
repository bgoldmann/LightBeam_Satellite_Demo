# Phase 1 Acceptance Checklist (PRD §23)

Track before declaring the satellite demo accepted:

- [ ] Web encoder accepts a selected file without uploading it
- [ ] Encoder exports a standards-compatible video (WebM→H.264 MP4 mezzanine OK)
- [ ] MP4 plays through the station’s test playout chain
- [ ] Android and iOS apps operate in airplane mode
- [ ] Both apps identify the same session and publisher
- [ ] Both apps can join after the transmission begins
- [ ] Both apps recover an exact byte-for-byte copy
- [ ] SHA-256 matches the original
- [ ] Publisher signature verifies (trusted key embedded)
- [ ] Damaged/modified transmission does not produce false Verified
- [ ] File can be saved/opened per platform rules
- [ ] Success on ≥3 Android and ≥3 iOS devices
- [ ] ≥1 success from recorded satellite downlink or full chain recording
- [ ] Operator guide usable by a station technician who did not build the system

## Photosensitive / safety review

- [ ] Broadcast safety review completed for public air
