# Troubleshooting

| Symptom | Likely cause | Mitigation |
|---------|--------------|------------|
| Searching forever | QR too small / glare / crop | Move closer; disable TV motion smoothing; check safe area |
| Session found, stuck collecting | High frame loss | Increase hold frames / redundancy; use Satellite Safe |
| Hash mismatch | Incomplete peel or wrong password | Continue scanning another loop; re-check encryption |
| Unknown publisher | Key not in app allowlist | Update app with trusted demo key |
| iOS cannot install from TV | Expected | App must be preinstalled via Apple channel |
| Web export slow | Large file / MediaRecorder | Use smaller demo file; prefer Studio profile for preview |
| Android no camera | Permission denied | Grant camera; no other permissions required |

Export a redacted diagnostic from Settings if available (no payload bytes, no passwords).
